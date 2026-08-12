import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRAND_COLOR,
  renderMagicLinkEmail,
  resolveBrandFrom,
} from './emailTemplate.js';

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

  it('falls back to the default color for anything that is not a hex color', () => {
    for (const invalid of [
      'red;} body { background: url(x) } ',
      '#0F766E" onmouseover="alert(1)',
      'expression(alert(1))',
      'url(javascript:alert(1))',
      '#12345',
      '',
    ]) {
      const { html } = renderMagicLinkEmail({
        brand: { ...brand, color: invalid },
        url,
      });
      expect(html).toContain(DEFAULT_BRAND_COLOR);
      if (invalid) expect(html).not.toContain(invalid);
    }
  });

  it('accepts short and alpha hex colors', () => {
    for (const valid of ['#fff', '#ffff', '#001C46', '#001C46FF']) {
      const { html } = renderMagicLinkEmail({
        brand: { ...brand, color: valid },
        url,
      });
      expect(html).toContain(valid);
    }
  });

  it('escapes single quotes in brand values', () => {
    const { html } = renderMagicLinkEmail({
      brand: { ...brand, productName: "O'Brien & Co" },
      url,
    });
    expect(html).toContain('O&#39;Brien &amp; Co');
    expect(html).not.toContain("O'Brien");
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

describe('locale and from defaults', () => {
  it('renders English copy with locale "en"', () => {
    const { html, text } = renderMagicLinkEmail({
      brand: { productName: 'Example Suite', locale: 'en' },
      url: 'https://app.example.com/login?token=abc',
    });
    expect(html).toContain('Sign in to Example Suite');
    expect(html).toContain('Sign in now');
    expect(html).toContain('you can safely ignore it');
    expect(text).toContain('Sign in to Example Suite (app.example.com)');
    expect(text).not.toContain('Anmelden');
  });

  it('defaults to German copy without locale', () => {
    const { html } = renderMagicLinkEmail({
      brand: { productName: 'Example App' },
      url: 'https://app.example.com/login?token=abc',
    });
    expect(html).toContain('Anmelden bei Example App');
    expect(html).toContain('Jetzt anmelden');
  });

  it('derives the fleet-standard From header from the product name', () => {
    expect(resolveBrandFrom({ productName: 'Example App' })).toBe(
      'Example App <noreply@mail.amadeni.ai>',
    );
    expect(
      resolveBrandFrom({
        productName: 'Example App',
        from: 'Custom <custom@example.com>',
      }),
    ).toBe('Custom <custom@example.com>');
  });
});
