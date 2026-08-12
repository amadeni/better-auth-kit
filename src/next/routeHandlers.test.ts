import { describe, expect, it, vi } from 'vitest';
import {
  createAuthRouteHandlers,
  unwrapRedirectEnvelope,
} from './routeHandlers.js';

const envelope = JSON.stringify({
  redirect: true,
  url: 'https://app.example.com/oauth/consent?x=1',
});

function navRequest(headers: Record<string, string> = {}) {
  return new Request('https://app.example.com/api/auth/oauth2/authorize', {
    headers: { 'sec-fetch-mode': 'navigate', ...headers },
  });
}

function jsonResponse(body: string) {
  return new Response(body, {
    headers: { 'content-type': 'application/json' },
  });
}

describe('unwrapRedirectEnvelope', () => {
  it('translates the {redirect,url} envelope into a 302 for navigations', async () => {
    const result = await unwrapRedirectEnvelope(
      navRequest(),
      jsonResponse(envelope),
    );
    expect(result.status).toBe(302);
    expect(result.headers.get('location')).toBe(
      'https://app.example.com/oauth/consent?x=1',
    );
    expect(result.headers.get('content-type')).toBeNull();
  });

  it('resolves relative envelope URLs against the request URL', async () => {
    const result = await unwrapRedirectEnvelope(
      navRequest(),
      jsonResponse(JSON.stringify({ redirect: true, url: '/dashboard' })),
    );
    expect(result.status).toBe(302);
    expect(result.headers.get('location')).toBe(
      'https://app.example.com/dashboard',
    );
  });

  it('treats missing sec-fetch-mode with an html accept header as navigation', async () => {
    const request = new Request('https://app.example.com/api/auth/x', {
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    const result = await unwrapRedirectEnvelope(
      request,
      jsonResponse(envelope),
    );
    expect(result.status).toBe(302);
  });

  it('leaves fetch (cors) requests untouched', async () => {
    const request = new Request('https://app.example.com/api/auth/x', {
      headers: { 'sec-fetch-mode': 'cors' },
    });
    const response = jsonResponse(envelope);
    const result = await unwrapRedirectEnvelope(request, response);
    expect(result).toBe(response);
    expect(result.status).toBe(200);
  });

  it('leaves non-JSON responses untouched', async () => {
    const response = new Response('<html></html>', {
      headers: { 'content-type': 'text/html' },
    });
    const result = await unwrapRedirectEnvelope(navRequest(), response);
    expect(result).toBe(response);
  });

  it('leaves JSON without a redirect envelope untouched', async () => {
    const response = jsonResponse(JSON.stringify({ status: 'ok' }));
    const result = await unwrapRedirectEnvelope(navRequest(), response);
    expect(result).toBe(response);
    // The body must still be readable by the caller (we only cloned).
    await expect(result.json()).resolves.toEqual({ status: 'ok' });
  });

  it('tolerates malformed JSON bodies', async () => {
    const response = jsonResponse('not-json');
    const result = await unwrapRedirectEnvelope(navRequest(), response);
    expect(result).toBe(response);
  });
});

describe('createAuthRouteHandlers', () => {
  it('wraps GET and POST with the redirect unwrap', async () => {
    const handler = {
      GET: vi.fn(async () => jsonResponse(envelope)),
      POST: vi.fn(async () => jsonResponse(JSON.stringify({ ok: true }))),
    };
    const { GET, POST } = createAuthRouteHandlers(handler);

    const getResult = await GET(navRequest());
    expect(handler.GET).toHaveBeenCalledTimes(1);
    expect(getResult.status).toBe(302);

    const postResult = await POST(navRequest());
    expect(handler.POST).toHaveBeenCalledTimes(1);
    expect(postResult.status).toBe(200);
  });
});
