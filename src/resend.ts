import type { SendMagicLink } from './authOptions.js';
import {
  renderMagicLinkEmail,
  resolveBrandFrom,
  type MagicLinkBrand,
} from './emailTemplate.js';
import { buildInterstitialLoginUrl } from './urls.js';

/**
 * Resolves the Resend API key with the fleet-wide fallback chain. Read at
 * call time (never at module scope) so it works inside Convex functions.
 */
export function resolveResendApiKey(
  env: Record<string, string | undefined> = process.env,
) {
  return env.AUTH_RESEND_KEY ?? env.AUTH_RESEND_API_KEY ?? env.RESEND_API_KEY;
}

export type ResendMagicLinkSenderConfig = {
  brand: MagicLinkBrand;
  /** Shown in the email's validity line; defaults to the kit's 24h TTL. */
  ttlHours?: number;
  /**
   * Builds the URL placed in the email. Defaults to the interstitial
   * `/login?token=…` page on the same origin as Better Auth's verify URL,
   * so mail scanners cannot consume the token. Override only if your login
   * route lives elsewhere.
   */
  buildLoginUrl?: (args: { url: string; token: string }) => string;
  /** Test seam; defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
};

/**
 * Creates the `sendMagicLink` implementation for
 * `createAmadeniAuthOptions`: renders the branded email and delivers it via
 * a single explicit HTTPS call to the Resend REST API (the kit's only
 * network call).
 */
export function createResendMagicLinkSender(
  config: ResendMagicLinkSenderConfig,
): SendMagicLink {
  const buildLoginUrl =
    config.buildLoginUrl ??
    (({ url, token }: { url: string; token: string }) =>
      buildInterstitialLoginUrl(new URL(url).origin, token));

  return async ({ email, token, url }) => {
    const apiKey = resolveResendApiKey();
    if (!apiKey) {
      throw new Error(
        'Resend API key is required. Set AUTH_RESEND_KEY, AUTH_RESEND_API_KEY, or RESEND_API_KEY.',
      );
    }

    const loginUrl = buildLoginUrl({ url, token });
    const { html, text, host } = renderMagicLinkEmail({
      brand: config.brand,
      url: loginUrl,
      ttlHours: config.ttlHours,
    });

    const fetchImpl = config.fetchImpl ?? fetch;
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: resolveBrandFrom(config.brand),
        to: email,
        // The timestamp keeps threads from collapsing repeated login mails.
        subject: `${config.brand.productName} Login Link (${host}) - ${new Date().toISOString()}`,
        html,
        text,
      }),
    });

    if (!res.ok) {
      throw new Error(`Resend error: ${JSON.stringify(await res.json())}`);
    }
  };
}
