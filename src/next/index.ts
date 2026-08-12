// Next.js entry point: middleware, route handlers, server helpers.

import { getSessionCookie } from 'better-auth/cookies';
// `.js` suffix: next ships no exports map, so nodenext resolution needs the
// concrete file; bundler resolution in consuming apps accepts it as well.
import { NextResponse, type NextRequest } from 'next/server.js';
import {
  decideAuthRoute,
  type DecideAuthRouteInput,
} from './decideAuthRoute.js';

export {
  decideAuthRoute,
  type AuthRouteDecision,
  type DecideAuthRouteInput,
} from './decideAuthRoute.js';
export {
  createAuthRouteHandlers,
  unwrapRedirectEnvelope,
  type AuthProxyHandler,
  type RedirectEnvelopeOptions,
} from './routeHandlers.js';
export { createAuthServer, type AuthServerConfig } from './authServer.js';

export type AuthNextMiddlewareOptions = Omit<
  DecideAuthRouteInput,
  'pathname' | 'search' | 'hasSessionCookie'
>;

/**
 * Ready-made Next.js middleware over `decideAuthRoute`, using Better Auth's
 * synchronous `getSessionCookie` presence check (no network round-trip).
 *
 * Named `createAuthNextMiddleware` (not `createAuthMiddleware`) to avoid
 * confusion with Better Auth's hook helper of that name, which typically
 * appears in the same app's `convex/auth.ts`.
 *
 * ```ts
 * // src/middleware.ts
 * import { createAuthNextMiddleware } from '@amadeni/better-auth-kit/next';
 * export default createAuthNextMiddleware();
 * // Inline literal required: Next.js statically parses `config` at build
 * // time, so importing AUTH_MIDDLEWARE_MATCHER here breaks `next build`.
 * // Add a drift-guard test asserting it equals AUTH_MIDDLEWARE_MATCHER.
 * export const config = {
 *   matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
 * };
 * ```
 */
export function createAuthNextMiddleware(
  options: AuthNextMiddlewareOptions = {},
) {
  return function authMiddleware(request: NextRequest) {
    const { pathname, search } = request.nextUrl;
    const decision = decideAuthRoute({
      ...options,
      pathname,
      search,
      // Cheap cookie presence check only — the authoritative check happens
      // in the root layout and in every Convex function.
      hasSessionCookie: Boolean(getSessionCookie(request)),
    });
    return decision.action === 'redirect'
      ? NextResponse.redirect(new URL(decision.location, request.url))
      : NextResponse.next();
  };
}

/** Matcher covering app routes while skipping static assets and `_next`. */
export const AUTH_MIDDLEWARE_MATCHER = [
  '/((?!.*\\..*|_next).*)',
  '/',
  '/(api|trpc)(.*)',
];
