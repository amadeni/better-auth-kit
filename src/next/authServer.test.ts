import { describe, expect, it } from 'vitest';
import { createAuthServer } from './authServer.js';

const convexUrl = 'https://happy-animal-123.convex.cloud';
const convexSiteUrl = 'https://happy-animal-123.convex.site';

describe('createAuthServer', () => {
  it('returns the Next.js auth server helpers for valid URLs', () => {
    const server = createAuthServer({ convexUrl, convexSiteUrl });
    expect(typeof server.handler.GET).toBe('function');
    expect(typeof server.handler.POST).toBe('function');
    expect(typeof server.isAuthenticated).toBe('function');
    expect(typeof server.getToken).toBe('function');
    expect(typeof server.fetchAuthQuery).toBe('function');
  });

  it('rejects invalid URLs with a clear message', () => {
    expect(() =>
      createAuthServer({ convexUrl: 'not-a-url', convexSiteUrl }),
    ).toThrow(/convexUrl is not a valid URL/);
    expect(() => createAuthServer({ convexUrl, convexSiteUrl: '' })).toThrow(
      /convexSiteUrl is not a valid URL/,
    );
  });

  it('rejects a convexSiteUrl that is not *.convex.site', () => {
    expect(() =>
      createAuthServer({
        convexUrl,
        convexSiteUrl: 'https://app.example.com',
      }),
    ).toThrow(/must be a \*\.convex\.site URL/);
  });

  it('names the classic mixup: .convex.cloud passed as convexSiteUrl', () => {
    expect(() =>
      createAuthServer({ convexUrl, convexSiteUrl: convexUrl }),
    ).toThrow(/\.convex\.cloud deployment URL/);
  });

  it('rejects lookalike hosts that merely end in the literal string', () => {
    expect(() =>
      createAuthServer({
        convexUrl,
        convexSiteUrl: 'https://evilconvex.site',
      }),
    ).toThrow(/must be a \*\.convex\.site URL/);
  });

  it('allows loopback hosts for local Convex backends by default', () => {
    for (const url of [
      'http://127.0.0.1:3211',
      'http://localhost:3211',
      'http://[::1]:3211',
    ]) {
      const server = createAuthServer({ convexUrl, convexSiteUrl: url });
      expect(typeof server.handler.GET).toBe('function');
    }
  });

  it('does not treat 127-prefixed public hosts as loopback', () => {
    expect(() =>
      createAuthServer({
        convexUrl,
        convexSiteUrl: 'https://127.example.com',
      }),
    ).toThrow(/must be a \*\.convex\.site URL/);
  });

  it('allows custom domains only with the explicit escape hatch', () => {
    const server = createAuthServer({
      convexUrl,
      convexSiteUrl: 'https://actions.example.com',
      allowNonConvexSiteUrl: true,
    });
    expect(typeof server.handler.GET).toBe('function');
  });
});
