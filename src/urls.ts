/**
 * Builds the interstitial login URL that goes into the magic link email.
 *
 * The email deliberately does NOT link to the verify endpoint directly:
 * corporate mail scanners follow (and thereby consume) links. The
 * interstitial `/login?token=…` page requires an explicit user click before
 * the token is handed to Better Auth's verify endpoint.
 */
export function buildInterstitialLoginUrl(
  siteUrl: string,
  token: string,
  options?: { loginPath?: string },
) {
  const base = siteUrl.replace(/\/+$/, '');
  const loginPath = options?.loginPath ?? '/login';
  return `${base}${loginPath}?token=${encodeURIComponent(token)}`;
}

/**
 * Builds the Better Auth magic link verify URL the interstitial page
 * navigates to when the user confirms the login. Returns a relative URL by
 * default (resolved against `window.location.origin` by the browser); pass
 * `origin` for an absolute URL.
 */
export function buildMagicLinkVerifyUrl(args: {
  token: string;
  callbackURL?: string;
  errorCallbackURL?: string;
  origin?: string;
  authApiBasePath?: string;
}) {
  const basePath = args.authApiBasePath ?? '/api/auth';
  const params = new URLSearchParams();
  params.set('token', args.token);
  params.set('callbackURL', args.callbackURL ?? '/');
  params.set('errorCallbackURL', args.errorCallbackURL ?? '/login');
  const origin = args.origin ? args.origin.replace(/\/+$/, '') : '';
  return `${origin}${basePath}/magic-link/verify?${params.toString()}`;
}
