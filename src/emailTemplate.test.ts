import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAND_COLOR, renderMagicLinkEmail } from './emailTemplate.js';

const brand = {
  productName: 'Example App',
  from: 'Example App <noreply@mail.example.com>',
};

const url = 'https://app.example.com/login?token=test-token';

describe('renderMagicLinkEmail', () => {
  it('renders the branded HTML email (snapshot)', () => {
    const { html } = renderMagicLinkEmail({ brand, url });
    expect(html).toMatchSnapshot();
  });

  it('renders the plain text fallback (snapshot)', () => {
    const { text } = renderMagicLinkEmail({ brand, url });
    expect(text).toMatchSnapshot();
  });

  it('links the button to the login URL', () => {
    const { html } = renderMagicLinkEmail({ brand, url });
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain('Jetzt anmelden');
  });

  it('escapes the host with zero-width spaces so it is readable but not auto-linked', () => {
    const { html, host } = renderMagicLinkEmail({ brand, url });
    expect(host).toBe('app.example.com');
    expect(html).toContain('app&#8203;.example&#8203;.com');
    expect(html).not.toContain('<strong>app.example.com</strong>');
  });

  it('uses the default brand color unless overridden', () => {
    const { html } = renderMagicLinkEmail({ brand, url });
    expect(html).toContain(DEFAULT_BRAND_COLOR);

    const custom = renderMagicLinkEmail({
      brand: { ...brand, color: '#001C46' },
      url,
    });
    expect(custom.html).toContain('#001C46');
    expect(custom.html).not.toContain(DEFAULT_BRAND_COLOR);
  });

  it('renders a logo only when configured', () => {
    const { html } = renderMagicLinkEmail({ brand, url });
    expect(html).not.toContain('<img');

    const withLogo = renderMagicLinkEmail({
      brand: { ...brand, logoUrl: 'https://cdn.example.com/logo.png' },
      url,
    });
    expect(withLogo.html).toContain('https://cdn.example.com/logo.png');
  });

  it('escapes HTML in the product name', () => {
    const { html } = renderMagicLinkEmail({
      brand: { ...brand, productName: 'App <&> "Co"' },
      url,
    });
    expect(html).toContain('App &lt;&amp;&gt; &quot;Co&quot;');
    expect(html).not.toContain('App <&>');
  });

  it('includes the raw URL in the text version for clients without HTML', () => {
    const { text } = renderMagicLinkEmail({ brand, url });
    expect(text).toContain(url);
    expect(text).toContain('Example App');
  });
});
