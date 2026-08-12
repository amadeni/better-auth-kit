export type RedirectEnvelopeOptions = {
  /**
   * Extra origins (e.g. an OAuth client's domain) the unwrap may redirect
   * to. Same-origin redirects are always allowed; anything else passes the
   * JSON envelope through unchanged instead of issuing the redirect.
   */
  allowedRedirectOrigins?: readonly string[];
};

/**
 * The Next.js proxy route forwards to Convex via undici's fetch, which
 * force-sets `sec-fetch-mode: cors` (`sec-*` are forbidden request headers
 * in the fetch spec). Better Auth then classifies real browser navigations
 * as fetch requests and answers `{redirect: true, url}` JSON instead of a
 * 302 — flows that end on a redirect (e.g. OAuth authorize) would land on a
 * raw JSON page. Translate the envelope back into a redirect for requests
 * that were navigations when they reached us.
 *
 * Defense-in-depth: the unwrap only ever *re-materializes* a redirect the
 * upstream already decided on, but a compromised or confused upstream must
 * not turn this into an open redirect — the resolved location has to be
 * same-origin with the request (or explicitly allow-listed via
 * `allowedRedirectOrigins`), otherwise the envelope is passed through
 * unchanged.
 */
export async function unwrapRedirectEnvelope(
  request: Request,
  response: Response,
  options?: RedirectEnvelopeOptions,
) {
  const mode = request.headers.get('sec-fetch-mode');
  const isNavigation =
    mode === 'navigate' ||
    (mode === null &&
      (request.headers.get('accept') ?? '').includes('text/html'));
  if (!isNavigation) return response;
  if (!(response.headers.get('content-type') ?? '').includes('json')) {
    return response;
  }
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  if (
    body === null ||
    typeof body !== 'object' ||
    (body as { redirect?: unknown }).redirect !== true ||
    typeof (body as { url?: unknown }).url !== 'string'
  ) {
    return response;
  }
  const location = new URL((body as { url: string }).url, request.url);
  const requestOrigin = new URL(request.url).origin;
  const isAllowedOrigin =
    location.origin === requestOrigin ||
    (options?.allowedRedirectOrigins ?? []).includes(location.origin);
  if (!isAllowedOrigin) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete('content-type');
  headers.delete('content-length');
  headers.set('location', location.toString());
  return new Response(null, { status: 302, headers });
}

export type AuthProxyHandler = {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
};

/**
 * Wraps the `createAuthServer().handler` for the catch-all
 * `app/api/auth/[...all]/route.ts`, applying `unwrapRedirectEnvelope` to
 * both methods.
 */
export function createAuthRouteHandlers(
  handler: AuthProxyHandler,
  options?: RedirectEnvelopeOptions,
) {
  return {
    GET: async (request: Request) =>
      unwrapRedirectEnvelope(request, await handler.GET(request), options),
    POST: async (request: Request) =>
      unwrapRedirectEnvelope(request, await handler.POST(request), options),
  };
}
