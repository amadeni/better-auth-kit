import { describe, expect, it } from 'vitest';
import { buildInterstitialLoginUrl, buildMagicLinkVerifyUrl } from './urls.js';

describe('buildInterstitialLoginUrl', () => {
  it('builds the /login?token= interstitial URL', () => {
    expect(buildInterstitialLoginUrl('https://app.example.com', 'abc123')).toBe(
      'https://app.example.com/login?token=abc123',
    );
  });

  it('URL-encodes the token', () => {
    expect(buildInterstitialLoginUrl('https://app.example.com', 'a b/c')).toBe(
      'https://app.example.com/login?token=a%20b%2Fc',
    );
  });

  it('tolerates a trailing slash on the site URL', () => {
    expect(buildInterstitialLoginUrl('https://app.example.com/', 'abc')).toBe(
      'https://app.example.com/login?token=abc',
    );
  });

  it('supports a custom login path', () => {
    expect(
      buildInterstitialLoginUrl('https://app.example.com', 'abc', {
        loginPath: '/anmelden',
      }),
    ).toBe('https://app.example.com/anmelden?token=abc');
  });
});

describe('buildMagicLinkVerifyUrl', () => {
  it('builds a relative verify URL with defaults', () => {
    expect(buildMagicLinkVerifyUrl({ token: 'abc' })).toBe(
      '/api/auth/magic-link/verify?token=abc&callbackURL=%2F&errorCallbackURL=%2Flogin',
    );
  });

  it('encodes the token and callback URLs', () => {
    const url = buildMagicLinkVerifyUrl({
      token: 'a b',
      callbackURL: '/dash?tab=1',
      errorCallbackURL: '/login?error=1',
    });
    expect(url).toBe(
      '/api/auth/magic-link/verify?token=a+b&callbackURL=%2Fdash%3Ftab%3D1&errorCallbackURL=%2Flogin%3Ferror%3D1',
    );
  });

  it('supports an absolute origin', () => {
    expect(
      buildMagicLinkVerifyUrl({
        token: 'abc',
        origin: 'https://app.example.com/',
      }),
    ).toBe(
      'https://app.example.com/api/auth/magic-link/verify?token=abc&callbackURL=%2F&errorCallbackURL=%2Flogin',
    );
  });

  it('supports a custom auth base path', () => {
    expect(
      buildMagicLinkVerifyUrl({ token: 'abc', authApiBasePath: '/api/ba' }),
    ).toBe(
      '/api/ba/magic-link/verify?token=abc&callbackURL=%2F&errorCallbackURL=%2Flogin',
    );
  });
});
