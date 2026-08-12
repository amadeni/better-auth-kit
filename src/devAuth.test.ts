// @vitest-environment node

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  DEV_AUTH_ENV_NAME,
  DEV_AUTH_TOKEN_TTL_MS,
  assertDevAuthEnabled,
  createDevAuth,
  createDevAuthTokenValue,
  requireDevAuthCliIdentity,
  type DevAuthVerificationInput,
} from './devAuth.js';

describe('assertDevAuthEnabled', () => {
  it('throws when the flag is missing', () => {
    expect(() => assertDevAuthEnabled({})).toThrow(/Dev auth is disabled/);
  });

  it.each(['false', '1', 'TRUE', 'True', 'yes', 'on', ''])(
    'throws for %j — only the exact string "true" enables dev auth',
    value => {
      expect(() =>
        assertDevAuthEnabled({ [DEV_AUTH_ENV_NAME]: value }),
      ).toThrow(/Dev auth is disabled/);
    },
  );

  it.each(['prod', 'prod:amadeni-hub', 'production:x', 'PROD:x', 'Prod'])(
    'refuses production-shaped deployment %j even when the flag is set',
    deployment => {
      expect(() =>
        assertDevAuthEnabled({
          [DEV_AUTH_ENV_NAME]: 'true',
          CONVEX_DEPLOYMENT: deployment,
        }),
      ).toThrow(/never available on production/);
    },
  );

  it('passes on a dev deployment with the flag set', () => {
    expect(() =>
      assertDevAuthEnabled({
        [DEV_AUTH_ENV_NAME]: 'true',
        CONVEX_DEPLOYMENT: 'dev:handsome-jellyfish-123',
      }),
    ).not.toThrow();
  });

  it('passes with the flag set and no CONVEX_DEPLOYMENT (anonymous local backend)', () => {
    expect(() =>
      assertDevAuthEnabled({ [DEV_AUTH_ENV_NAME]: 'true' }),
    ).not.toThrow();
  });

  it('does not treat prefixes like "produce:" or names containing prod as production', () => {
    expect(() =>
      assertDevAuthEnabled({
        [DEV_AUTH_ENV_NAME]: 'true',
        CONVEX_DEPLOYMENT: 'dev:prod-like-name',
      }),
    ).not.toThrow();
  });
});

describe('createDevAuthTokenValue', () => {
  it('produces unique URL-safe tokens with two UUIDs of entropy', () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => createDevAuthTokenValue()),
    );
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(token).toMatch(/^[0-9a-f-]{73}$/);
    }
  });
});

describe('requireDevAuthCliIdentity', () => {
  const expected = { issuer: 'app-dev-auth', subject: 'dev-auth-cli' };
  const ctxWith = (identity: { issuer?: string; subject?: string } | null) => ({
    auth: { getUserIdentity: async () => identity },
  });

  it('accepts the configured CLI identity', async () => {
    await expect(
      requireDevAuthCliIdentity(
        ctxWith({ issuer: 'app-dev-auth', subject: 'dev-auth-cli' }),
        expected,
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    null,
    { issuer: 'other', subject: 'dev-auth-cli' },
    { issuer: 'app-dev-auth', subject: 'other' },
    { issuer: 'app-dev-auth' },
  ])('rejects %j', async identity => {
    await expect(
      requireDevAuthCliIdentity(ctxWith(identity), expected),
    ).rejects.toThrow(/CLI identity required/);
  });
});

describe('createDevAuth().issueToken', () => {
  type Ctx = { tag: 'ctx' };
  const ctx: Ctx = { tag: 'ctx' };
  const enabledEnv = {
    [DEV_AUTH_ENV_NAME]: 'true',
    CONVEX_DEPLOYMENT: 'dev:test-123',
  };

  function setup(overrides?: {
    env?: Record<string, string | undefined>;
    tokenTtlMs?: number;
    defaultEmail?: string;
    userName?: string;
  }) {
    const created: DevAuthVerificationInput[] = [];
    const ensured: { email: string; name: string }[] = [];
    const devAuth = createDevAuth<Ctx>({
      createVerification: async (_ctx, input) => {
        created.push(input);
      },
      ensureUser: async (_ctx, args) => {
        ensured.push(args);
      },
      env: overrides?.env ?? enabledEnv,
      now: () => 1_700_000_000_000,
      ...(overrides?.tokenTtlMs !== undefined
        ? { tokenTtlMs: overrides.tokenTtlMs }
        : {}),
      ...(overrides?.defaultEmail !== undefined
        ? { defaultEmail: overrides.defaultEmail }
        : {}),
      ...(overrides?.userName !== undefined
        ? { userName: overrides.userName }
        : {}),
    });
    return { devAuth, created, ensured };
  }

  it('enforces the gate: throws when disabled and writes nothing', async () => {
    const { devAuth, created, ensured } = setup({ env: {} });
    await expect(devAuth.issueToken(ctx)).rejects.toThrow(
      /Dev auth is disabled/,
    );
    expect(created).toHaveLength(0);
    expect(ensured).toHaveLength(0);
  });

  it('enforces the production guard even with the flag set', async () => {
    const { devAuth, created } = setup({
      env: { [DEV_AUTH_ENV_NAME]: 'true', CONVEX_DEPLOYMENT: 'prod:hub' },
    });
    await expect(devAuth.issueToken(ctx)).rejects.toThrow(
      /never available on production/,
    );
    expect(created).toHaveLength(0);
  });

  it('stores the verification row under the better-auth-compatible token hash', async () => {
    const { devAuth, created } = setup();
    const { token } = await devAuth.issueToken(ctx, {
      email: 'dev@example.com',
    });

    expect(created).toHaveLength(1);
    const row = created[0];
    expect(row.model).toBe('verification');
    // Byte-compatible with better-auth's defaultKeyHasher (see hashToken.ts):
    // SHA-256 of the raw token, base64url without padding.
    expect(row.data.identifier).toBe(
      createHash('sha256').update(token).digest('base64url'),
    );
    expect(JSON.parse(row.data.value)).toEqual({
      email: 'dev@example.com',
      name: 'Amadeni Dev',
    });
  });

  it('applies the token TTL relative to the injected clock', async () => {
    const { devAuth, created } = setup();
    await devAuth.issueToken(ctx);
    expect(created[0].data.createdAt).toBe(1_700_000_000_000);
    expect(created[0].data.updatedAt).toBe(1_700_000_000_000);
    expect(created[0].data.expiresAt).toBe(
      1_700_000_000_000 + DEV_AUTH_TOKEN_TTL_MS,
    );

    const custom = setup({ tokenTtlMs: 60_000 });
    await custom.devAuth.issueToken(ctx);
    expect(custom.created[0].data.expiresAt).toBe(1_700_000_000_000 + 60_000);
  });

  it('ensures the app user with the canonical email BEFORE persisting the token', async () => {
    const order: string[] = [];
    const devAuth = createDevAuth<Ctx>({
      createVerification: async () => {
        order.push('createVerification');
      },
      ensureUser: async (_ctx, args) => {
        order.push(`ensureUser:${args.email}`);
      },
      env: enabledEnv,
    });
    await devAuth.issueToken(ctx, { email: '  Dev@Example.COM ' });
    expect(order).toEqual(['ensureUser:dev@example.com', 'createVerification']);
  });

  it('falls back to the default email and returns the resolved email', async () => {
    const { devAuth, ensured } = setup({ defaultEmail: 'Robot@Dev.Local' });
    const { email } = await devAuth.issueToken(ctx);
    expect(email).toBe('robot@dev.local');
    expect(ensured[0].email).toBe('robot@dev.local');
  });

  it('mints a fresh token per call (single-use semantics)', async () => {
    const { devAuth } = setup();
    const first = await devAuth.issueToken(ctx);
    const second = await devAuth.issueToken(ctx);
    expect(first.token).not.toBe(second.token);
  });

  it('works without ensureUser (component-only apps)', async () => {
    const createVerification = vi.fn(async () => undefined);
    const devAuth = createDevAuth<Ctx>({ createVerification, env: enabledEnv });
    await expect(devAuth.issueToken(ctx)).resolves.toMatchObject({
      email: 'dev@amadeni.local',
    });
    expect(createVerification).toHaveBeenCalledOnce();
  });
});

describe('createDevAuth().buildVerifyUrl', () => {
  it('builds the magic link verify URL for the minted token', () => {
    const devAuth = createDevAuth({
      createVerification: async () => undefined,
      env: { [DEV_AUTH_ENV_NAME]: 'true' },
    });
    expect(
      devAuth.buildVerifyUrl({
        token: 'tok',
        origin: 'http://localhost:3001',
      }),
    ).toBe(
      'http://localhost:3001/api/auth/magic-link/verify?token=tok&callbackURL=%2F&errorCallbackURL=%2Flogin',
    );
  });
});
