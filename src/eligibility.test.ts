import { describe, expect, it, vi } from 'vitest';
import { APIError } from 'better-auth/api';
import {
  createEligibilityHandler,
  createEligibilityHook,
  evaluateLoginEligibility,
  resolveEligibilityEmail,
  type EligibilityHookContext,
} from './eligibility.js';
import { AUTH_ERROR_CODES } from './errorCodes.js';
import { hashVerificationToken } from './hashToken.js';

const adapterWith = (
  records: Record<string, { value: string } | undefined>,
) => ({
  findVerificationValue: vi.fn(async (identifier: string) => {
    return records[identifier] ?? null;
  }),
});

const hookCtx = (
  partial: Partial<EligibilityHookContext> & { path: string },
  adapter = adapterWith({}),
): EligibilityHookContext => ({
  context: { internalAdapter: adapter },
  ...partial,
});

describe('evaluateLoginEligibility', () => {
  const base = {
    canonicalEmail: 'user@example.com',
    canonicalInitialAdminEmail: undefined as string | undefined,
    existingUserDeletedAt: undefined as number | null | undefined,
    hasExistingUser: false,
    hasAnyUser: false,
  };

  it('rejects an empty email', () => {
    expect(evaluateLoginEligibility({ ...base, canonicalEmail: '' })).toEqual({
      ok: false,
      error: AUTH_ERROR_CODES.EMAIL_MISSING,
    });
  });

  it('accepts an existing, non-deleted user', () => {
    expect(
      evaluateLoginEligibility({ ...base, hasExistingUser: true }),
    ).toEqual({ ok: true, reason: 'existing-user' });
  });

  it('rejects a soft-deleted user', () => {
    expect(
      evaluateLoginEligibility({
        ...base,
        hasExistingUser: true,
        existingUserDeletedAt: 1700000000000,
      }),
    ).toEqual({ ok: false, error: AUTH_ERROR_CODES.SIGN_IN_LINK_UNAVAILABLE });
  });

  it('rejects unknown emails once the deployment has users (closed registration)', () => {
    expect(evaluateLoginEligibility({ ...base, hasAnyUser: true })).toEqual({
      ok: false,
      error: AUTH_ERROR_CODES.SIGN_IN_LINK_UNAVAILABLE,
    });
  });

  it('requires INITIAL_ADMIN_EMAIL to bootstrap an empty deployment', () => {
    expect(evaluateLoginEligibility(base)).toEqual({
      ok: false,
      error: AUTH_ERROR_CODES.INITIAL_ADMIN_EMAIL_REQUIRED,
    });
  });

  it('bootstraps the initial admin on an empty deployment', () => {
    expect(
      evaluateLoginEligibility({
        ...base,
        canonicalInitialAdminEmail: 'user@example.com',
      }),
    ).toEqual({ ok: true, reason: 'bootstrap-admin' });
  });

  it('rejects a non-matching email on an empty deployment', () => {
    expect(
      evaluateLoginEligibility({
        ...base,
        canonicalInitialAdminEmail: 'admin@example.com',
      }),
    ).toEqual({ ok: false, error: AUTH_ERROR_CODES.SIGN_IN_LINK_UNAVAILABLE });
  });

  it('supports a custom deny code for wire compatibility', () => {
    expect(
      evaluateLoginEligibility(
        { ...base, hasAnyUser: true },
        { denyCode: AUTH_ERROR_CODES.USER_NOT_FOUND },
      ),
    ).toEqual({ ok: false, error: AUTH_ERROR_CODES.USER_NOT_FOUND });
  });
});

describe('resolveEligibilityEmail', () => {
  it('reads the email from the sign-in body', async () => {
    const email = await resolveEligibilityEmail(
      hookCtx({
        path: '/sign-in/magic-link',
        body: { email: 'user@example.com' },
      }),
    );
    expect(email).toBe('user@example.com');
  });

  it('treats a missing sign-in email as an empty (ineligible) address', async () => {
    const email = await resolveEligibilityEmail(
      hookCtx({ path: '/sign-in/magic-link', body: {} }),
    );
    expect(email).toBe('');
  });

  it('resolves the verify path through the hashed verification record', async () => {
    const token = 'raw-magic-link-token';
    const adapter = adapterWith({
      [await hashVerificationToken(token)]: {
        value: JSON.stringify({ email: 'pending@example.com' }),
      },
    });

    const email = await resolveEligibilityEmail(
      hookCtx({ path: '/magic-link/verify', query: { token } }, adapter),
    );

    expect(email).toBe('pending@example.com');
    expect(adapter.findVerificationValue).toHaveBeenCalledWith(
      await hashVerificationToken(token),
    );
  });

  it('skips the check for unknown verify tokens so the plugin rejects them itself', async () => {
    const email = await resolveEligibilityEmail(
      hookCtx({ path: '/magic-link/verify', query: { token: 'unknown' } }),
    );
    expect(email).toBeNull();
  });

  it('skips the check when the verify request carries no token', async () => {
    const email = await resolveEligibilityEmail(
      hookCtx({ path: '/magic-link/verify', query: {} }),
    );
    expect(email).toBeNull();
  });

  it('fails closed on malformed verification payloads', async () => {
    const token = 'raw-magic-link-token';
    const adapter = adapterWith({
      [await hashVerificationToken(token)]: { value: 'not-json' },
    });

    const email = await resolveEligibilityEmail(
      hookCtx({ path: '/magic-link/verify', query: { token } }, adapter),
    );
    expect(email).toBe('');
  });

  it('skips when the adapter lookup throws — the verify endpoint fails on its own then', async () => {
    const adapter = {
      findVerificationValue: vi.fn(async () => {
        throw new Error('adapter unavailable');
      }),
    };
    const email = await resolveEligibilityEmail(
      hookCtx({ path: '/magic-link/verify', query: { token: 'x' } }, adapter),
    );
    expect(email).toBeNull();
  });

  it('ignores unrelated auth endpoints', async () => {
    const email = await resolveEligibilityEmail(
      hookCtx({ path: '/get-session' }),
    );
    expect(email).toBeNull();
  });
});

describe('createEligibilityHandler', () => {
  it('passes eligible sign-in requests through', async () => {
    const isEligible = vi.fn(async () => ({ ok: true }) as const);
    const handler = createEligibilityHandler({ isEligible });

    await expect(
      handler(
        hookCtx({
          path: '/sign-in/magic-link',
          body: { email: 'user@example.com' },
        }),
      ),
    ).resolves.toBeUndefined();
    expect(isEligible).toHaveBeenCalledWith('user@example.com');
  });

  it('throws APIError BAD_REQUEST with the eligibility code', async () => {
    const handler = createEligibilityHandler({
      isEligible: async () => ({
        ok: false,
        error: AUTH_ERROR_CODES.SIGN_IN_LINK_UNAVAILABLE,
      }),
    });

    const call = handler(
      hookCtx({
        path: '/sign-in/magic-link',
        body: { email: 'user@example.com' },
      }),
    );

    await expect(call).rejects.toBeInstanceOf(APIError);
    await expect(call).rejects.toMatchObject({
      body: { message: AUTH_ERROR_CODES.SIGN_IN_LINK_UNAVAILABLE },
    });
  });

  it('re-checks eligibility on the verify path', async () => {
    const token = 'raw-magic-link-token';
    const adapter = adapterWith({
      [await hashVerificationToken(token)]: {
        value: JSON.stringify({ email: 'deleted@example.com' }),
      },
    });
    const isEligible = vi.fn(async () => ({
      ok: false as const,
      error: AUTH_ERROR_CODES.SIGN_IN_LINK_UNAVAILABLE,
    }));
    const handler = createEligibilityHandler({ isEligible });

    await expect(
      handler(
        hookCtx({ path: '/magic-link/verify', query: { token } }, adapter),
      ),
    ).rejects.toBeInstanceOf(APIError);
    expect(isEligible).toHaveBeenCalledWith('deleted@example.com');
  });

  it('does not call isEligible for unrelated endpoints', async () => {
    const isEligible = vi.fn(async () => ({ ok: true }) as const);
    const handler = createEligibilityHandler({ isEligible });

    await handler(hookCtx({ path: '/get-session' }));
    expect(isEligible).not.toHaveBeenCalled();
  });

  it('supports a custom verify-path email resolver', async () => {
    const isEligible = vi.fn(async () => ({ ok: true }) as const);
    const resolveEmailForVerify = vi.fn(async () => 'custom@example.com');
    const handler = createEligibilityHandler({
      isEligible,
      resolveEmailForVerify,
    });

    await handler(
      hookCtx({ path: '/magic-link/verify', query: { token: 'raw' } }),
    );
    expect(resolveEmailForVerify).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'raw' }),
    );
    expect(isEligible).toHaveBeenCalledWith('custom@example.com');
  });
});

describe('createEligibilityHook', () => {
  it('creates a Better Auth middleware', () => {
    const hook = createEligibilityHook({
      isEligible: async () => ({ ok: true }),
    });
    expect(typeof hook).toBe('function');
  });
});
