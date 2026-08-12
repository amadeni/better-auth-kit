// @vitest-environment node

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { betterAuth } from 'better-auth/minimal';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createAmadeniAuthOptions } from './authOptions.js';
import { hashVerificationToken } from './hashToken.js';

describe('hashVerificationToken', () => {
  it('is SHA-256, base64url encoded without padding', async () => {
    const token = 'test-token-value';
    const expected = createHash('sha256').update(token).digest('base64url');

    await expect(hashVerificationToken(token)).resolves.toBe(expected);
  });

  it('produces padding-free URL-safe output for many random tokens', async () => {
    for (let i = 0; i < 25; i++) {
      const token = crypto.randomUUID() + crypto.randomUUID();
      const hash = await hashVerificationToken(token);
      expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(hash).toBe(createHash('sha256').update(token).digest('base64url'));
    }
  });

  it('stays byte-compatible with better-auth: the magic link plugin stores the verification row under exactly this hash', async () => {
    // Functional parity test against better-auth itself (defaultKeyHasher is
    // not exported): run a real sign-in through the kit's options with
    // `storeToken: 'hashed'` and assert the stored verification identifier
    // equals our hash of the raw token. This is the contract dev-auth and
    // convex-e2e `createSession` implementations rely on.
    const sent: { email: string; token: string; url: string }[] = [];
    const db: Record<string, { identifier?: string; value?: string }[]> = {
      user: [],
      session: [],
      account: [],
      verification: [],
      rateLimit: [],
      jwks: [],
    };

    const options = createAmadeniAuthOptions({
      baseURL: 'http://localhost:3000',
      sendMagicLink: async data => {
        sent.push(data);
      },
    });

    const auth = betterAuth({
      ...options,
      secret: 'better-auth-kit-parity-test-secret',
      database: memoryAdapter(db),
      // The convex plugin skips database writes outside a real Convex
      // mutation context, so it would swallow the verification row we are
      // asserting on. Hash parity only depends on the magic link plugin
      // configured by the factory, so drop the convex plugin here.
      plugins: options.plugins.filter(plugin => plugin.id !== 'convex'),
    });

    await auth.api.signInMagicLink({
      body: { email: 'parity@example.com', callbackURL: '/' },
      headers: new Headers(),
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].token.length).toBeGreaterThan(10);

    const identifiers = db.verification.map(row => row.identifier);
    expect(identifiers).toContain(await hashVerificationToken(sent[0].token));
    // The raw token itself must never be stored.
    expect(identifiers).not.toContain(sent[0].token);
    expect(
      db.verification.some(row => row.value?.includes(sent[0].token)),
    ).toBe(false);
  });
});
