export type AuthRouteDecision =
  { action: 'next' } | { action: 'redirect'; location: string };

export type DecideAuthRouteInput = {
  pathname: string;
  /** Raw query string, with or without the leading `?`. */
  search: string;
  /** Cheap cookie-presence signal from `getSessionCookie(request)`. */
  hasSessionCookie: boolean;
  /** Paths reachable without a session. The sign-in path is always public. */
  publicPaths?: readonly string[];
  /** Defaults to `/login`. */
  signInPath?: string;
  /** Better Auth endpoints prefix; always passed through. Default `/api/auth`. */
  authApiBasePath?: string;
  /** Where authenticated users land when visiting a public page. Default `/`. */
  homePath?: string;
  /**
   * Query params that keep an authenticated user on a public page instead of
   * redirecting home — e.g. `client_id` while an OAuth authorization is in
   * flight, where the redirect would drop the signed continuation params.
   */
  resumeQueryParams?: readonly string[];
};

/**
 * The pure routing decision behind `createAuthNextMiddleware`. Encodes the
 * fleet-standard middleware behavior:
 *
 * - `/api/auth/*` always passes through: the magic link verify URL carries a
 *   `token` param the redirect rule below would otherwise swallow, and auth
 *   endpoints have to stay reachable without a session.
 * - A `?token=…` on a protected path redirects to the sign-in interstitial
 *   (`/login?token=…`) so the confirm-login page can consume it.
 * - Authenticated visitors on public pages go home (unless resuming OAuth).
 * - Unauthenticated visitors on protected pages go to sign-in.
 *
 * The cookie check is presence-only by design — the authoritative session
 * check happens in the app layout and in every Convex function.
 */
export function decideAuthRoute(
  input: DecideAuthRouteInput,
): AuthRouteDecision {
  const signInPath = input.signInPath ?? '/login';
  const authApiBasePath = input.authApiBasePath ?? '/api/auth';
  const homePath = input.homePath ?? '/';
  const resumeQueryParams = input.resumeQueryParams ?? ['client_id'];
  const publicPaths = new Set([...(input.publicPaths ?? []), signInPath]);

  if (
    input.pathname === authApiBasePath ||
    input.pathname.startsWith(`${authApiBasePath}/`)
  ) {
    return { action: 'next' };
  }

  const isPublic = publicPaths.has(input.pathname);
  const params = new URLSearchParams(
    input.search.startsWith('?') ? input.search.slice(1) : input.search,
  );

  const token = params.get('token');
  if (token && !isPublic) {
    return {
      action: 'redirect',
      location: `${signInPath}?token=${encodeURIComponent(token)}`,
    };
  }

  if (isPublic && input.hasSessionCookie) {
    const isResuming = resumeQueryParams.some(param => params.has(param));
    if (!isResuming) {
      return { action: 'redirect', location: homePath };
    }
    return { action: 'next' };
  }

  if (!isPublic && !input.hasSessionCookie) {
    return { action: 'redirect', location: signInPath };
  }

  return { action: 'next' };
}
