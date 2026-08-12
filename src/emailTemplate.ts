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

/** Matches the kit's default magic link TTL (createAmadeniAuthOptions). */
export const DEFAULT_MAGIC_LINK_TTL_HOURS = 24;

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

// German copy is deliberately pronoun-free (neither "Sie" nor "Du") so no
// project has to pick a form of address for its login mail.
const COPY: Record<
  MagicLinkLocale,
  {
    title: (productName: string) => string;
    intro: string;
    button: string;
    validity: (escapedHost: string, ttlHours: number) => string;
    footer: (productName: string) => string;
    textHeading: (productName: string, host: string) => string;
    textValidity: (host: string, ttlHours: number) => string;
    textFooter: string;
  }
> = {
  de: {
    title: productName => `Anmelden bei ${productName}`,
    intro: 'Ein Klick genügt, um die Anmeldung abzuschließen:',
    button: 'Jetzt anmelden',
    validity: (escapedHost, ttlHours) =>
      `Gilt für <strong>${escapedHost}</strong> &middot; ${ttlHours} Stunden gültig`,
    footer: productName =>
      `Diese E-Mail wurde automatisch von ${productName} gesendet. Falls die Anmeldung nicht angefordert wurde, kann diese Nachricht einfach ignoriert werden.`,
    textHeading: (productName, host) => `Anmelden bei ${productName} (${host})`,
    textValidity: (host, ttlHours) =>
      `Gilt für ${host} - ${ttlHours} Stunden gültig`,
    textFooter:
      'Falls die Anmeldung nicht angefordert wurde, kann diese Nachricht einfach ignoriert werden.',
  },
  en: {
    title: productName => `Sign in to ${productName}`,
    intro: 'Use the button below to complete your sign-in:',
    button: 'Sign in now',
    validity: (escapedHost, ttlHours) =>
      `Valid for <strong>${escapedHost}</strong> &middot; expires in ${ttlHours} hours`,
    footer: productName =>
      `This email was sent automatically by ${productName}. If this sign-in was not requested, this message can safely be ignored.`,
    textHeading: (productName, host) => `Sign in to ${productName} (${host})`,
    textValidity: (host, ttlHours) =>
      `Valid for ${host} - expires in ${ttlHours} hours`,
    textFooter:
      'If this sign-in was not requested, this message can safely be ignored.',
  },
};

/**
 * Renders the branded magic link email as the fleet-standard card layout
 * (eyebrow "<productName> Login", title, button, one muted validity line,
 * ignore-hint in the footer below the card — mirrors the Amadeni Hub
 * customer notification design). German copy by default (pronoun-free),
 * English via `brand.locale`. Pure — snapshot tested. The host is rendered
 * with zero-width spaces after each dot so mail clients do not auto-link it
 * and users can still read where the link goes.
 */
export function renderMagicLinkEmail(params: {
  brand: MagicLinkBrand;
  url: string;
  /** Shown in the validity line; defaults to the kit's magic link TTL. */
  ttlHours?: number;
}) {
  const { brand, url } = params;
  const ttlHours = params.ttlHours ?? DEFAULT_MAGIC_LINK_TTL_HOURS;
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
              ${productName} Login
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
              <table border="0" cellspacing="0" cellpadding="0" style="margin: 8px 0 20px 0;">
                <tr>
                  <td align="center" style="border-radius: 8px;" bgcolor="${color.button}">
                    <a href="${href}" target="_blank" style="${font} font-size: 15px; font-weight: bold; color: ${color.buttonText}; text-decoration: none; border-radius: 8px; padding: 12px 24px; display: inline-block;">
                      ${copy.button}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="${font} font-size: 13px; line-height: 1.6; color: ${color.muted}; margin: 0 0 24px 0;">
                ${copy.validity(escapedHost, ttlHours)}
              </p>
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

  const text = `${copy.textHeading(brand.productName, host)}\n${url}\n\n${copy.textValidity(host, ttlHours)}\n${copy.textFooter}`;

  return { html, text, host };
}
