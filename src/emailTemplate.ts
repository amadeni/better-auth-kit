export type MagicLinkLocale = 'de' | 'en';

export type MagicLinkBrand = {
  /** Product name shown in the email, e.g. "Amadeni Hub". */
  productName: string;
  /**
   * From header. Defaults to the fleet standard
   * `<productName> <noreply@mail.amadeni.ai>`.
   */
  from?: string;
  /** Email copy language; defaults to German. */
  locale?: MagicLinkLocale;
  /** Brand color for eyebrow and button; defaults to the Amadeni violet. */
  color?: string;
  /** Optional logo rendered above the card content. */
  logoUrl?: string;
};

export const DEFAULT_BRAND_COLOR = '#5b21b6';

/** #rgb, #rgba, #rrggbb, or #rrggbbaa. */
const HEX_COLOR_PATTERN =
  /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Only hex colors are accepted for the button; anything else falls back to
 * the default. This keeps `brand.color` from ever injecting markup into the
 * style/bgcolor attribute contexts (where entity escaping alone would not
 * be a sufficient defense).
 */
function safeBrandColor(color: string | undefined) {
  if (color && HEX_COLOR_PATTERN.test(color)) return color;
  return DEFAULT_BRAND_COLOR;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Fleet-standard From header: `<productName> <noreply@mail.amadeni.ai>`. */
export function resolveBrandFrom(brand: MagicLinkBrand) {
  return brand.from ?? `${brand.productName} <noreply@mail.amadeni.ai>`;
}

const COPY: Record<
  MagicLinkLocale,
  {
    title: (productName: string) => string;
    intro: string;
    button: string;
    ignore: string;
    footer: (productName: string) => string;
    textHeading: (productName: string, host: string) => string;
    textIgnore: string;
  }
> = {
  de: {
    title: productName => `Anmelden bei ${productName}`,
    intro: 'Mit dem Button unten schließen Sie Ihre Anmeldung ab:',
    button: 'Jetzt anmelden',
    ignore:
      'Wenn Sie diese E-Mail nicht angefordert haben, können Sie sie ignorieren.',
    footer: productName =>
      `Diese E-Mail wurde automatisch von ${productName} gesendet.`,
    textHeading: (productName, host) => `Anmelden bei ${productName} (${host})`,
    textIgnore:
      'Wenn Sie diese E-Mail nicht angefordert haben, koennen Sie sie ignorieren.',
  },
  en: {
    title: productName => `Sign in to ${productName}`,
    intro: 'Use the button below to complete your sign-in:',
    button: 'Sign in now',
    ignore: 'If you did not request this email, you can safely ignore it.',
    footer: productName =>
      `This email was sent automatically by ${productName}.`,
    textHeading: (productName, host) => `Sign in to ${productName} (${host})`,
    textIgnore: 'If you did not request this email, you can safely ignore it.',
  },
};

/**
 * Renders the branded magic link email as the fleet-standard card layout
 * (eyebrow with the product name, title, button, muted note box, footer
 * below the card — mirrors the Amadeni Hub customer notification design).
 * German copy by default, English via `brand.locale`. Pure — snapshot
 * tested. The host is rendered with zero-width spaces after each dot so mail
 * clients do not auto-link it and users can still read where the link goes.
 */
export function renderMagicLinkEmail(params: {
  brand: MagicLinkBrand;
  url: string;
}) {
  const { brand, url } = params;
  const copy = COPY[brand.locale ?? 'de'];
  const { host } = new URL(url);
  const escapedHost = escapeHtml(host).replace(/\./g, '&#8203;.');
  const productName = escapeHtml(brand.productName);
  const brandColor = safeBrandColor(brand.color);
  const href = escapeHtml(url);

  const color = {
    background: '#F6F8FC',
    card: '#FFFFFF',
    heading: '#1F2937',
    text: '#374151',
    muted: '#6B7280',
    noteBackground: '#F9FAFB',
    noteBorder: '#E5E7EB',
    button: brandColor,
    buttonText: '#FFFFFF',
  };

  const font = 'font-family: Helvetica, Arial, sans-serif;';

  const logoRow = brand.logoUrl
    ? `
          <tr>
            <td style="padding: 32px 32px 0 32px;">
              <img src="${escapeHtml(brand.logoUrl)}" alt="${productName}" height="36" style="height: 36px; width: auto;" />
            </td>
          </tr>`
    : '';

  const html = `
<body style="background: ${color.background}; margin: 0; padding: 0; -webkit-font-smoothing: antialiased; word-spacing: normal;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background: ${color.background};">
    <tr>
      <td align="center" style="padding: 24px 16px;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background: ${color.card}; max-width: 600px; margin: auto; border-radius: 12px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);">${logoRow}
          <tr>
            <td style="padding: 32px 32px 8px 32px; ${font} font-size: 13px; font-weight: bold; letter-spacing: 0.08em; text-transform: uppercase; color: ${color.button};">
              ${productName}
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 32px 16px 32px; ${font} font-size: 21px; font-weight: bold; line-height: 1.4; color: ${color.heading};">
              ${copy.title(productName)}
            </td>
          </tr>
          <tr>
            <td style="padding: 0 32px 8px 32px;">
              <p style="${font} font-size: 15px; line-height: 1.6; color: ${color.text}; margin: 0 0 16px 0;">${copy.intro}</p>
              <table border="0" cellspacing="0" cellpadding="0" style="margin: 8px 0 24px 0;">
                <tr>
                  <td align="center" style="border-radius: 8px;" bgcolor="${color.button}">
                    <a href="${href}" target="_blank" style="${font} font-size: 15px; font-weight: bold; color: ${color.buttonText}; text-decoration: none; border-radius: 8px; padding: 12px 24px; display: inline-block;">
                      ${copy.button}
                    </a>
                  </td>
                </tr>
              </table>
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0 0 24px 0;">
                <tr>
                  <td style="${font} font-size: 13px; line-height: 1.6; color: ${color.muted}; background: ${color.noteBackground}; border: 1px solid ${color.noteBorder}; border-radius: 8px; padding: 12px 16px;">
                    <strong>${escapedHost}</strong><br />${copy.ignore}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: auto;">
          <tr>
            <td align="center" style="padding: 16px 32px; ${font} font-size: 12px; line-height: 1.5; color: ${color.muted};">
              ${copy.footer(productName)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
`;

  const text = `${copy.textHeading(brand.productName, host)}\n${url}\n\n${copy.textIgnore}`;

  return { html, text, host };
}
