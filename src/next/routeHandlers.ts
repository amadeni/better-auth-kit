/**
 * The Next.js proxy route forwards to Convex via undici's fetch, which
 * force-sets `sec-fetch-mode: cors` (`sec-*` are forbidden request headers
 * in the fetch spec). Better Auth then classifies real browser navigations
 * as fetch requests and answers `{redirect: true, url}` JSON instead of a
 * 302 — flows that end on a redirect (e.g. OAuth authorize) would land on a
 * raw JSON page. Translate the envelope back into a redirect for requests
 * that were navigations when they reached us.
 */
export async function unwrapRedirectEnvelope(
  request: Request,
  response: Response,
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
export function createAuthRouteHandlers(handler: AuthProxyHandler) {
  return {
    GET: async (request: Request) =>
      unwrapRedirectEnvelope(request, await handler.GET(request)),
    POST: async (request: Request) =>
      unwrapRedirectEnvelope(request, await handler.POST(request)),
  };
}
