export type MagicLinkBrand = {
  /** Product name shown in the email, e.g. "Amadeni Hub". */
  productName: string;
  /** From header, e.g. "Amadeni Hub <noreply@mail.amadeni.ai>". */
  from: string;
  /** Brand color for the button; defaults to Amadeni teal. */
  color?: string;
  /** Optional logo rendered above the heading. */
  logoUrl?: string;
};

export const DEFAULT_BRAND_COLOR = '#0F766E';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders the branded magic link email (German copy). Pure — snapshot
 * tested. The host is rendered with zero-width spaces after each dot so mail
 * clients do not auto-link it and users can still read where the link goes.
 */
export function renderMagicLinkEmail(params: {
  brand: MagicLinkBrand;
  url: string;
}) {
  const { brand, url } = params;
  const { host } = new URL(url);
  const escapedHost = escapeHtml(host).replace(/\./g, '&#8203;.');
  const productName = escapeHtml(brand.productName);
  const buttonColor = brand.color ?? DEFAULT_BRAND_COLOR;
  const href = escapeHtml(url);

  const color = {
    background: '#F6F8FC',
    text: '#1F2937',
    muted: '#6B7280',
    mainBackground: '#FFFFFF',
    buttonBackground: buttonColor,
    buttonBorder: buttonColor,
    buttonText: '#FFFFFF',
  };

  const logoRow = brand.logoUrl
    ? `
          <tr>
            <td align="center" style="padding: 32px 24px 0 24px;">
              <img src="${escapeHtml(brand.logoUrl)}" alt="${productName}" height="36" style="height: 36px; width: auto;" />
            </td>
          </tr>`
    : '';

  const html = `
<body style="background: ${color.background}; margin: 0; padding: 0; -webkit-font-smoothing: antialiased; word-spacing: normal;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background: ${color.background};">
    <tr>
      <td align="center" style="padding: 20px;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background: ${color.mainBackground}; max-width: 600px; margin: auto; border-radius: 12px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);">${logoRow}
          <tr>
            <td align="center" style="padding: 32px 24px; font-size: 24px; font-family: Helvetica, Arial, sans-serif; color: ${color.text}; line-height: 1.4;">
              Anmelden bei ${productName}<br/>
              (<strong>${escapedHost}</strong>)
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 0 24px 32px 24px;">
              <table border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="border-radius: 8px;" bgcolor="${color.buttonBackground}">
                    <a href="${href}" target="_blank" style="font-size: 18px; font-family: Helvetica, Arial, sans-serif; color: ${color.buttonText}; text-decoration: none; border-radius: 8px; padding: 12px 24px; border: 1px solid ${color.buttonBorder}; display: inline-block; font-weight: bold;">
                      Jetzt anmelden
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 0 24px 24px 24px; font-size: 14px; line-height: 1.5; font-family: Helvetica, Arial, sans-serif; color: ${color.muted};">
              Wenn Sie diese E-Mail nicht angefordert haben, k&ouml;nnen Sie sie ignorieren.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
`;

  const text = `Anmelden bei ${brand.productName} (${host})\n${url}\n\nWenn Sie diese E-Mail nicht angefordert haben, koennen Sie sie ignorieren.`;

  return { html, text, host };
}
