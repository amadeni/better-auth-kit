import { describe, expect, it } from 'vitest';
import { betterAuth } from 'better-auth/minimal';
import { memoryAdapter } from 'better-auth/adapters/memory';
import {
  createAmadeniAuthOptions,
  MAGIC_LINK_TTL_SECONDS,
  SESSION_TTL_SECONDS,
} from './authOptions.js';

const pluginIds = (options: { plugins: { id: string }[] }) =>
  options.plugins.map(plugin => plugin.id);

describe('createAmadeniAuthOptions', () => {
  it('is callable without arguments (component directory / schema generation)', () => {
    const options = createAmadeniAuthOptions();
    expect(options.baseURL).toBeUndefined();
    expect(pluginIds(options)).toEqual(['magic-link', 'convex']);
  });

  it('enforces database-backed rate limiting (Convex runtime is stateless)', () => {
    expect(createAmadeniAuthOptions().rateLimit).toEqual({
      storage: 'database',
    });
  });

  it('applies the fleet TTL defaults: 24h magic link, 30d session', () => {
    const options = createAmadeniAuthOptions();
    expect(options.session).toEqual({ expiresIn: SESSION_TTL_SECONDS });
    expect(SESSION_TTL_SECONDS).toBe(60 * 60 * 24 * 30);
    expect(MAGIC_LINK_TTL_SECONDS).toBe(60 * 60 * 24);
  });

  it('allows tuning the TTLs without touching the hardened settings', () => {
    const options = createAmadeniAuthOptions({
      sessionTtlSeconds: 60 * 60,
      magicLinkTtlSeconds: 60 * 5,
    });
    expect(options.session).toEqual({ expiresIn: 60 * 60 });
    expect(options.rateLimit).toEqual({ storage: 'database' });
  });

  it('passes baseURL and appName through', () => {
    const options = createAmadeniAuthOptions({
      baseURL: 'https://app.example.com',
      appName: 'Example App',
    });
    expect(options.baseURL).toBe('https://app.example.com');
    expect(options.appName).toBe('Example App');
  });

  it('orders extra plugins BEFORE the kit plugins so hardened endpoints win last-wins merging', () => {
    // Better Auth merges plugin endpoints last-wins and only logs conflicts,
    // so the kit's magic-link/convex plugins must come last.
    const extra = { id: 'extra-plugin' } as never;
    const options = createAmadeniAuthOptions({ extraPlugins: [extra] });
    expect(pluginIds(options)).toEqual([
      'extra-plugin',
      'magic-link',
      'convex',
    ]);
  });

  it('always wires the magic link and convex plugins — they cannot be removed', () => {
    const options = createAmadeniAuthOptions({ extraPlugins: [] });
    expect(pluginIds(options)).toContain('magic-link');
    expect(pluginIds(options)).toContain('convex');
  });

  it('rejects extraPlugins that try to override the reserved magic-link plugin', () => {
    // A consumer shipping its own magicLink({ storeToken: 'plain' }) must
    // fail fast instead of silently downgrading token storage.
    const rogueMagicLink = { id: 'magic-link' } as never;
    expect(() =>
      createAmadeniAuthOptions({ extraPlugins: [rogueMagicLink] }),
    ).toThrow(/reserved id "magic-link"/);
  });

  it('rejects extraPlugins that try to override the reserved convex plugin', () => {
    const rogueConvex = { id: 'convex' } as never;
    expect(() =>
      createAmadeniAuthOptions({ extraPlugins: [rogueConvex] }),
    ).toThrow(/reserved id "convex"/);
  });

  it('fails loudly at send time when sendMagicLink is not configured', async () => {
    // Without a sender the sign-in must error, not silently drop the email.
    const options = createAmadeniAuthOptions({
      baseURL: 'http://localhost:3000',
    });
    const auth = betterAuth({
      ...options,
      secret: 'send-config-test-secret-send-config-test',
      database: memoryAdapter({}),
      // See hashToken.test.ts: the convex plugin skips writes outside a
      // real Convex mutation context.
      plugins: options.plugins.filter(plugin => plugin.id !== 'convex'),
    });

    await expect(
      auth.api.signInMagicLink({
        body: { email: 'user@example.com', callbackURL: '/' },
        headers: new Headers(),
      }),
    ).rejects.toThrow();
  });
});

// The enforced `storeToken: 'hashed'` and the wiring of `sendMagicLink` are
// asserted functionally in hashToken.test.ts: a real sign-in through these
// options stores the verification row under the hashed token and calls the
// provided sender exactly once.
