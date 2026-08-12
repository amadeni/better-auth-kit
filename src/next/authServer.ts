import { convexBetterAuthNextJs } from '@convex-dev/better-auth/nextjs';

export type AuthServerConfig = {
  /** The Convex cloud URL (`NEXT_PUBLIC_CONVEX_URL`), `*.convex.cloud`. */
  convexUrl: string;
  /**
   * The Convex HTTP actions URL (`NEXT_PUBLIC_CONVEX_SITE_URL`),
   * `*.convex.site` — NOT the `.convex.cloud` URL and not your app's own
   * domain.
   */
  convexSiteUrl: string;
  /**
   * Skip the `.convex.site` host check, e.g. for a custom domain mapped to
   * Convex HTTP actions. Only set this when you know the URL serves Convex
   * HTTP actions.
   */
  allowNonConvexSiteUrl?: boolean;
};

function parseUrl(value: string, name: string) {
  try {
    return new URL(value);
  } catch {
    throw new Error(
      `createAuthServer: ${name} is not a valid URL: ${JSON.stringify(value)}. ` +
        'Check your environment configuration.',
    );
  }
}

/**
 * Thin wrapper around `convexBetterAuthNextJs` that validates the two URLs
 * up front — the classic misconfiguration (passing the `.convex.cloud` URL
 * as `convexSiteUrl`) otherwise only surfaces as opaque auth failures at
 * request time.
 *
 * Returns `{ handler, preloadAuthQuery, isAuthenticated, getToken,
 * fetchAuthQuery, fetchAuthMutation, fetchAuthAction }`.
 */
export function createAuthServer(
  config: AuthServerConfig,
): ReturnType<typeof convexBetterAuthNextJs> {
  parseUrl(config.convexUrl, 'convexUrl');
  const siteUrl = parseUrl(config.convexSiteUrl, 'convexSiteUrl');

  if (
    !config.allowNonConvexSiteUrl &&
    !siteUrl.hostname.endsWith('.convex.site')
  ) {
    const hint = siteUrl.hostname.endsWith('.convex.cloud')
      ? ' It looks like you passed the .convex.cloud deployment URL — convexSiteUrl must be the HTTP actions URL, which ends in .convex.site.'
      : ' Pass allowNonConvexSiteUrl: true only if this custom domain really serves Convex HTTP actions.';
    throw new Error(
      `createAuthServer: convexSiteUrl must be a *.convex.site URL, got ${JSON.stringify(config.convexSiteUrl)}.${hint}`,
    );
  }

  return convexBetterAuthNextJs({
    convexUrl: config.convexUrl,
    convexSiteUrl: config.convexSiteUrl,
  });
}
