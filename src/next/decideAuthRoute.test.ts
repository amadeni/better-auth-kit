import { describe, expect, it } from 'vitest';
import { decideAuthRoute, type AuthRouteDecision } from './decideAuthRoute.js';

const next: AuthRouteDecision = { action: 'next' };
const redirect = (location: string): AuthRouteDecision => ({
  action: 'redirect',
  location,
});

describe('decideAuthRoute', () => {
  it.each([
    // --- /api/auth passthrough (verify URLs carry ?token=) ---
    ['/api/auth/magic-link/verify', '?token=abc', false, next],
    ['/api/auth/get-session', '', true, next],
    ['/api/auth', '', false, next],
    // --- protected paths ---
    ['/', '', false, redirect('/login')],
    ['/projects/42', '', false, redirect('/login')],
    ['/', '', true, next],
    ['/projects/42', '?tab=1', true, next],
    // --- token redirect to the sign-in interstitial ---
    ['/', '?token=abc', false, redirect('/login?token=abc')],
    ['/', '?token=abc', true, redirect('/login?token=abc')],
    ['/deep/path', '?token=a%20b&x=1', true, redirect('/login?token=a%20b')],
    // --- public sign-in page ---
    ['/login', '', false, next],
    ['/login', '?token=abc', false, next],
    ['/login', '', true, redirect('/')],
    ['/login', '?token=abc', true, redirect('/')],
    // OAuth authorization in flight: keep the login page reachable.
    ['/login', '?client_id=xyz&state=1', true, next],
  ] as const)(
    'pathname=%s search=%s session=%s',
    (pathname, search, hasSessionCookie, expected) => {
      expect(decideAuthRoute({ pathname, search, hasSessionCookie })).toEqual(
        expected,
      );
    },
  );

  it('URL-encodes the token on redirect', () => {
    expect(
      decideAuthRoute({
        pathname: '/',
        search: '?token=a b/c',
        hasSessionCookie: false,
      }),
    ).toEqual(redirect('/login?token=a%20b%2Fc'));
  });

  it('treats additional publicPaths as public', () => {
    const input = {
      pathname: '/dev-auth/agent',
      search: '',
      hasSessionCookie: false,
      publicPaths: ['/dev-auth/agent'],
    };
    expect(decideAuthRoute(input)).toEqual(next);
    expect(decideAuthRoute({ ...input, publicPaths: [] })).toEqual(
      redirect('/login'),
    );
  });

  it('always treats the sign-in path itself as public', () => {
    expect(
      decideAuthRoute({
        pathname: '/anmelden',
        search: '',
        hasSessionCookie: false,
        signInPath: '/anmelden',
      }),
    ).toEqual(next);
  });

  it('supports a custom sign-in path for redirects', () => {
    expect(
      decideAuthRoute({
        pathname: '/',
        search: '',
        hasSessionCookie: false,
        signInPath: '/anmelden',
      }),
    ).toEqual(redirect('/anmelden'));
    expect(
      decideAuthRoute({
        pathname: '/',
        search: '?token=abc',
        hasSessionCookie: false,
        signInPath: '/anmelden',
      }),
    ).toEqual(redirect('/anmelden?token=abc'));
  });

  it('supports a custom home path for authenticated visitors on public pages', () => {
    expect(
      decideAuthRoute({
        pathname: '/login',
        search: '',
        hasSessionCookie: true,
        homePath: '/dashboard',
      }),
    ).toEqual(redirect('/dashboard'));
  });

  it('supports custom resume params', () => {
    expect(
      decideAuthRoute({
        pathname: '/login',
        search: '?continue=1',
        hasSessionCookie: true,
        resumeQueryParams: ['continue'],
      }),
    ).toEqual(next);
  });

  it('does not treat /api/auth-lookalikes as passthrough', () => {
    expect(
      decideAuthRoute({
        pathname: '/api/authors',
        search: '',
        hasSessionCookie: false,
      }),
    ).toEqual(redirect('/login'));
  });
});
