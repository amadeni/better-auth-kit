import { canonicalizeAuthEmail } from './canonicalizeEmail.js';
import { AUTH_ERROR_CODES } from './errorCodes.js';
import { evaluateLoginEligibility } from './eligibility.js';

export type LazyLinkReason = 'existing-user' | 'bootstrap-admin';

export type LazyLinkTriggerConfig<Ctx, UserId> = {
  /** Email equality; defaults to `canonicalizeAuthEmail`. */
  canonicalize?: (email: string) => string;
  /**
   * Looks up the app user for a canonical email. Must be unique — throw on
   * duplicates (e.g. Convex `.unique()`), the trigger propagates the error
   * and aborts the sign-in.
   */
  findAppUserByEmail: (
    ctx: Ctx,
    canonicalEmail: string,
  ) => Promise<{ _id: UserId; deletedAt?: number | null } | null>;
  /** `true` when any app user exists (including soft-deleted ones). */
  hasAnyAppUser: (ctx: Ctx) => Promise<boolean>;
  /**
   * Writes the app user id onto the Better Auth component user row
   * (`adapter.updateOne` on model `user`, field `userId`).
   */
  linkComponentUser: (
    ctx: Ctx,
    args: { authUserId: string; appUserId: UserId },
  ) => Promise<void>;
  /**
   * Creates the initial admin app user. Only ever called when the users
   * table is empty AND the email matches INITIAL_ADMIN_EMAIL. Omitting it
   * disables bootstrapping entirely.
   */
  bootstrapInitialAdmin?: (
    ctx: Ctx,
    args: { email: string },
  ) => Promise<UserId>;
  /** Defaults to reading `process.env.INITIAL_ADMIN_EMAIL` at call time. */
  getInitialAdminEmail?: () => string | undefined;
  /** Post-link side effects (activate invites, audit log, …). */
  onLinked?: (
    ctx: Ctx,
    args: { appUserId: UserId; authUserId: string; reason: LazyLinkReason },
  ) => Promise<void>;
  /**
   * Error code thrown for ineligible addresses; defaults to
   * `AUTH_ERROR_CODES.USER_NOT_FOUND` (the historical trigger behavior).
   */
  denyCode?: string;
};

/**
 * The `user.onCreate` trigger building block: registration is closed, so a
 * Better Auth component user is only ever created on a first successful
 * sign-in. This trigger lazily links that component user to the existing app
 * user with the same (canonical) email — or bootstraps the initial admin
 * while the users table is still empty.
 *
 * Throwing aborts the component user creation, so an ineligible email can
 * never complete a sign-in even if it slipped past the send-time guard.
 *
 * Fully generic: no imports from any app's `_generated` — all table access
 * goes through the injected callbacks.
 */
export function createLazyLinkTrigger<Ctx, UserId>(
  config: LazyLinkTriggerConfig<Ctx, UserId>,
) {
  const canonicalize = config.canonicalize ?? canonicalizeAuthEmail;
  const getInitialAdminEmail =
    config.getInitialAdminEmail ?? (() => process.env.INITIAL_ADMIN_EMAIL);

  return async (
    ctx: Ctx,
    authUser: { _id: string; email?: string | null },
  ): Promise<UserId> => {
    const canonicalEmail = canonicalize(authUser.email ?? '');
    if (!canonicalEmail) {
      throw new Error(AUTH_ERROR_CODES.EMAIL_MISSING);
    }

    const existingUser = await config.findAppUserByEmail(ctx, canonicalEmail);
    const hasAnyUser =
      existingUser !== null || (await config.hasAnyAppUser(ctx));
    const initialAdminEmail = getInitialAdminEmail();

    const eligibility = evaluateLoginEligibility(
      {
        canonicalEmail,
        canonicalInitialAdminEmail: initialAdminEmail
          ? canonicalize(initialAdminEmail)
          : undefined,
        existingUserDeletedAt: existingUser?.deletedAt,
        hasExistingUser: existingUser !== null,
        hasAnyUser,
      },
      { denyCode: config.denyCode ?? AUTH_ERROR_CODES.USER_NOT_FOUND },
    );

    if (!eligibility.ok) {
      throw new Error(eligibility.error);
    }

    let appUserId: UserId;
    let reason: LazyLinkReason;
    if (eligibility.reason === 'existing-user' && existingUser) {
      appUserId = existingUser._id;
      reason = 'existing-user';
    } else {
      if (!config.bootstrapInitialAdmin) {
        throw new Error(config.denyCode ?? AUTH_ERROR_CODES.USER_NOT_FOUND);
      }
      appUserId = await config.bootstrapInitialAdmin(ctx, {
        email: canonicalEmail,
      });
      reason = 'bootstrap-admin';
    }

    await config.linkComponentUser(ctx, {
      authUserId: authUser._id,
      appUserId,
    });
    await config.onLinked?.(ctx, {
      appUserId,
      authUserId: authUser._id,
      reason,
    });
    return appUserId;
  };
}
