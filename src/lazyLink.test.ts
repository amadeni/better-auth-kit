import { describe, expect, it, vi } from 'vitest';
import { AUTH_ERROR_CODES } from './errorCodes.js';
import { createLazyLinkTrigger } from './lazyLink.js';

type Ctx = { name: string };
const ctx: Ctx = { name: 'fake-ctx' };

type UserRow = { _id: string; deletedAt?: number | null };

function fakeCallbacks(input: {
  users?: Record<string, UserRow>;
  hasAnyUser?: boolean;
  initialAdminEmail?: string;
  withBootstrap?: boolean;
}) {
  const users = input.users ?? {};
  const linkComponentUser = vi.fn(async () => {});
  const onLinked = vi.fn(async () => {});
  const bootstrapInitialAdmin = vi.fn(async () => 'bootstrapped-admin-id');
  return {
    callbacks: {
      findAppUserByEmail: vi.fn(
        async (_ctx: Ctx, email: string) => users[email] ?? null,
      ),
      hasAnyAppUser: vi.fn(
        async () => input.hasAnyUser ?? Object.keys(users).length > 0,
      ),
      linkComponentUser,
      ...(input.withBootstrap === false ? {} : { bootstrapInitialAdmin }),
      getInitialAdminEmail: () => input.initialAdminEmail,
      onLinked,
    },
    linkComponentUser,
    onLinked,
    bootstrapInitialAdmin,
  };
}

describe('createLazyLinkTrigger', () => {
  it('links an existing app user by canonical email', async () => {
    const { callbacks, linkComponentUser, onLinked } = fakeCallbacks({
      users: { 'user@example.com': { _id: 'app-user-1' } },
    });
    const trigger = createLazyLinkTrigger<Ctx, string>(callbacks);

    const appUserId = await trigger(ctx, {
      _id: 'auth-user-1',
      email: '  User@Example.COM ',
    });

    expect(appUserId).toBe('app-user-1');
    expect(callbacks.findAppUserByEmail).toHaveBeenCalledWith(
      ctx,
      'user@example.com',
    );
    expect(linkComponentUser).toHaveBeenCalledWith(ctx, {
      authUserId: 'auth-user-1',
      appUserId: 'app-user-1',
    });
    expect(onLinked).toHaveBeenCalledWith(ctx, {
      appUserId: 'app-user-1',
      authUserId: 'auth-user-1',
      reason: 'existing-user',
    });
  });

  it('throws EMAIL_MISSING when the auth user has no email', async () => {
    const { callbacks, linkComponentUser } = fakeCallbacks({});
    const trigger = createLazyLinkTrigger<Ctx, string>(callbacks);

    await expect(trigger(ctx, { _id: 'auth-user-1' })).rejects.toThrow(
      AUTH_ERROR_CODES.EMAIL_MISSING,
    );
    await expect(
      trigger(ctx, { _id: 'auth-user-1', email: '   ' }),
    ).rejects.toThrow(AUTH_ERROR_CODES.EMAIL_MISSING);
    expect(linkComponentUser).not.toHaveBeenCalled();
  });

  it('rejects soft-deleted users', async () => {
    const { callbacks, linkComponentUser } = fakeCallbacks({
      users: {
        'user@example.com': { _id: 'app-user-1', deletedAt: 1700000000000 },
      },
    });
    const trigger = createLazyLinkTrigger<Ctx, string>(callbacks);

    await expect(
      trigger(ctx, { _id: 'auth-user-1', email: 'user@example.com' }),
    ).rejects.toThrow(AUTH_ERROR_CODES.USER_NOT_FOUND);
    expect(linkComponentUser).not.toHaveBeenCalled();
  });

  it('rejects unknown emails once any user exists (closed registration)', async () => {
    const { callbacks } = fakeCallbacks({
      users: { 'other@example.com': { _id: 'app-user-2' } },
      initialAdminEmail: 'admin@example.com',
    });
    const trigger = createLazyLinkTrigger<Ctx, string>(callbacks);

    await expect(
      trigger(ctx, { _id: 'auth-user-1', email: 'user@example.com' }),
    ).rejects.toThrow(AUTH_ERROR_CODES.USER_NOT_FOUND);
  });

  it('bootstraps the initial admin while the users table is empty', async () => {
    const { callbacks, bootstrapInitialAdmin, linkComponentUser, onLinked } =
      fakeCallbacks({ initialAdminEmail: 'Admin@Example.com' });
    const trigger = createLazyLinkTrigger<Ctx, string>(callbacks);

    const appUserId = await trigger(ctx, {
      _id: 'auth-user-1',
      email: 'admin@example.com',
    });

    expect(appUserId).toBe('bootstrapped-admin-id');
    expect(bootstrapInitialAdmin).toHaveBeenCalledWith(ctx, {
      email: 'admin@example.com',
    });
    expect(linkComponentUser).toHaveBeenCalledWith(ctx, {
      authUserId: 'auth-user-1',
      appUserId: 'bootstrapped-admin-id',
    });
    expect(onLinked).toHaveBeenCalledWith(ctx, {
      appUserId: 'bootstrapped-admin-id',
      authUserId: 'auth-user-1',
      reason: 'bootstrap-admin',
    });
  });

  it('requires INITIAL_ADMIN_EMAIL for the bootstrap', async () => {
    const { callbacks, bootstrapInitialAdmin } = fakeCallbacks({});
    const trigger = createLazyLinkTrigger<Ctx, string>(callbacks);

    await expect(
      trigger(ctx, { _id: 'auth-user-1', email: 'user@example.com' }),
    ).rejects.toThrow(AUTH_ERROR_CODES.INITIAL_ADMIN_EMAIL_REQUIRED);
    expect(bootstrapInitialAdmin).not.toHaveBeenCalled();
  });

  it('rejects a bootstrap attempt from a non-matching email', async () => {
    const { callbacks, bootstrapInitialAdmin } = fakeCallbacks({
      initialAdminEmail: 'admin@example.com',
    });
    const trigger = createLazyLinkTrigger<Ctx, string>(callbacks);

    await expect(
      trigger(ctx, { _id: 'auth-user-1', email: 'intruder@example.com' }),
    ).rejects.toThrow(AUTH_ERROR_CODES.USER_NOT_FOUND);
    expect(bootstrapInitialAdmin).not.toHaveBeenCalled();
  });

  it('denies the bootstrap case when bootstrapInitialAdmin is not provided', async () => {
    const { callbacks } = fakeCallbacks({
      initialAdminEmail: 'admin@example.com',
      withBootstrap: false,
    });
    const trigger = createLazyLinkTrigger<Ctx, string>(callbacks);

    await expect(
      trigger(ctx, { _id: 'auth-user-1', email: 'admin@example.com' }),
    ).rejects.toThrow(AUTH_ERROR_CODES.USER_NOT_FOUND);
  });

  it('propagates duplicate-email lookup errors (e.g. Convex .unique())', async () => {
    const { callbacks, linkComponentUser } = fakeCallbacks({});
    callbacks.findAppUserByEmail = vi.fn(async () => {
      throw new Error('unique() returned more than one result');
    });
    const trigger = createLazyLinkTrigger<Ctx, string>(callbacks);

    await expect(
      trigger(ctx, { _id: 'auth-user-1', email: 'user@example.com' }),
    ).rejects.toThrow('unique() returned more than one result');
    expect(linkComponentUser).not.toHaveBeenCalled();
  });

  it('uses a custom canonicalize (e.g. sub-address stripping) consistently', async () => {
    const stripPlus = (email: string) => {
      const [local, domain] = email.trim().toLowerCase().split('@');
      return `${local?.split('+')[0]}@${domain}`;
    };
    const { callbacks } = fakeCallbacks({
      users: { 'user@example.com': { _id: 'app-user-1' } },
    });
    const trigger = createLazyLinkTrigger<Ctx, string>({
      ...callbacks,
      canonicalize: stripPlus,
    });

    const appUserId = await trigger(ctx, {
      _id: 'auth-user-1',
      email: 'User+invite@example.com',
    });
    expect(appUserId).toBe('app-user-1');
  });

  it('supports a custom deny code', async () => {
    const { callbacks } = fakeCallbacks({ hasAnyUser: true });
    const trigger = createLazyLinkTrigger<Ctx, string>({
      ...callbacks,
      denyCode: AUTH_ERROR_CODES.SIGN_IN_LINK_UNAVAILABLE,
    });

    await expect(
      trigger(ctx, { _id: 'auth-user-1', email: 'user@example.com' }),
    ).rejects.toThrow(AUTH_ERROR_CODES.SIGN_IN_LINK_UNAVAILABLE);
  });

  it('reads INITIAL_ADMIN_EMAIL from the environment by default', async () => {
    const { callbacks, bootstrapInitialAdmin } = fakeCallbacks({});
    const trigger = createLazyLinkTrigger<Ctx, string>({
      ...callbacks,
      getInitialAdminEmail: undefined,
    });

    const previous = process.env.INITIAL_ADMIN_EMAIL;
    process.env.INITIAL_ADMIN_EMAIL = 'env-admin@example.com';
    try {
      const appUserId = await trigger(ctx, {
        _id: 'auth-user-1',
        email: 'env-admin@example.com',
      });
      expect(appUserId).toBe('bootstrapped-admin-id');
      expect(bootstrapInitialAdmin).toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.INITIAL_ADMIN_EMAIL;
      else process.env.INITIAL_ADMIN_EMAIL = previous;
    }
  });
});
