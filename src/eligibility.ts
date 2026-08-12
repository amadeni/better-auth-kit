import {
  APIError,
  createAuthMiddleware,
  type AuthMiddleware,
} from 'better-auth/api';
import { AUTH_ERROR_CODES } from './errorCodes.js';
import { hashVerificationToken } from './hashToken.js';

export type LoginEligibility =
  | { ok: true; reason?: 'existing-user' | 'bootstrap-admin' }
  | { ok: false; error: string };

/**
 * Closed registration: only users that already exist may sign in. The single
 * exception bootstraps the initial admin while the users table is empty.
 *
 * Pure so it can be unit tested and shared by the send-time guard
 * (`checkLoginEligibility` queries) and the authoritative Better Auth
 * user-creation trigger (`createLazyLinkTrigger`).
 *
 * `denyCode` defaults to the non-enumerating `SIGN_IN_LINK_UNAVAILABLE`;
 * apps that historically exposed `USER_NOT_FOUND` (the Hub) can keep their
 * wire format by passing it explicitly.
 */
export function evaluateLoginEligibility(
  input: {
    canonicalEmail: string;
    canonicalInitialAdminEmail: string | undefined;
    existingUserDeletedAt: number | null | undefined;
    hasExistingUser: boolean;
    hasAnyUser: boolean;
  },
  options?: { denyCode?: string },
): LoginEligibility {
  const denyCode =
    options?.denyCode ?? AUTH_ERROR_CODES.SIGN_IN_LINK_UNAVAILABLE;

  if (!input.canonicalEmail) {
    return { ok: false, error: AUTH_ERROR_CODES.EMAIL_MISSING };
  }

  if (input.hasExistingUser) {
    return input.existingUserDeletedAt
      ? { ok: false, error: denyCode }
      : { ok: true, reason: 'existing-user' };
  }

  // Somebody already owns this deployment — no self registration.
  if (input.hasAnyUser) {
    return { ok: false, error: denyCode };
  }

  if (!input.canonicalInitialAdminEmail) {
    return { ok: false, error: AUTH_ERROR_CODES.INITIAL_ADMIN_EMAIL_REQUIRED };
  }

  return input.canonicalEmail === input.canonicalInitialAdminEmail
    ? { ok: true, reason: 'bootstrap-admin' }
    : { ok: false, error: denyCode };
}

type FindVerificationValue = (
  identifier: string,
) => Promise<{ value: string } | null | undefined>;

export type EligibilityHookContext = {
  path: string;
  body?: unknown;
  query?: unknown;
  context: {
    internalAdapter: {
      findVerificationValue: FindVerificationValue;
    };
  };
};

export type ResolveEmailForVerify = (args: {
  token: string;
  findVerificationValue: FindVerificationValue;
}) => Promise<string | null>;

/**
 * Default `/magic-link/verify` email resolution: the plugin stores the
 * pending verification row under the hashed token (`storeToken: 'hashed'`),
 * so hash the raw token, look the row up through Better Auth's internal
 * adapter, and read the email from its JSON value.
 *
 * Fails closed: malformed rows resolve to `''` (which no eligibility check
 * accepts), and a *failing* lookup (adapter/infra error) propagates and
 * denies the request — an outage must never skip the re-check. Only a
 * definitively missing row resolves to `null` (skip — the plugin then
 * rejects the unknown token itself, and we must not leak anything about it).
 */
export const resolveVerifyEmailFromHashedToken: ResolveEmailForVerify = async ({
  token,
  findVerificationValue,
}) => {
  const verification = await findVerificationValue(
    await hashVerificationToken(token),
  );
  if (!verification) return null;
  try {
    const parsed: unknown = JSON.parse(verification.value);
    const email =
      parsed && typeof parsed === 'object'
        ? (parsed as { email?: unknown }).email
        : undefined;
    return typeof email === 'string' ? email : '';
  } catch {
    return '';
  }
};

/**
 * Resolves the email address whose login eligibility a request must pass, or
 * `null` when the request needs no eligibility check (other endpoints, or
 * verify calls with an unknown token).
 *
 * Covering `/magic-link/verify` matters because a user can be deleted (or
 * lose eligibility) between the magic link being sent and being clicked;
 * without the re-check the user-creation trigger would throw
 * mid-transaction during verify.
 */
export async function resolveEligibilityEmail(
  hookCtx: EligibilityHookContext,
  resolveEmailForVerify: ResolveEmailForVerify = resolveVerifyEmailFromHashedToken,
): Promise<string | null> {
  if (hookCtx.path === '/sign-in/magic-link') {
    const body = hookCtx.body as { email?: string } | undefined;
    return body?.email ?? '';
  }

  if (hookCtx.path === '/magic-link/verify') {
    const query = hookCtx.query as { token?: string } | undefined;
    if (!query?.token) return null;
    return resolveEmailForVerify({
      token: query.token,
      findVerificationValue: identifier =>
        hookCtx.context.internalAdapter.findVerificationValue(identifier),
    });
  }

  return null;
}

export type EligibilityHookConfig = {
  /**
   * App-provided eligibility check (typically a Convex `runQuery` against
   * the app users table). Receives the raw email from the request; do your
   * own canonicalization inside.
   */
  isEligible: (email: string) => Promise<LoginEligibility> | LoginEligibility;
  /** Override the token-to-email resolution on the verify path. */
  resolveEmailForVerify?: ResolveEmailForVerify;
};

/**
 * Plain async handler backing `createEligibilityHook`. Exported separately
 * so it can be unit tested without Better Auth's middleware runner.
 */
export function createEligibilityHandler(config: EligibilityHookConfig) {
  return async (hookCtx: EligibilityHookContext) => {
    const email = await resolveEligibilityEmail(
      hookCtx,
      config.resolveEmailForVerify,
    );
    if (email === null) return;
    const eligibility = await config.isEligible(email);
    if (!eligibility.ok) {
      throw new APIError('BAD_REQUEST', { message: eligibility.error });
    }
  };
}

/**
 * Better Auth `hooks.before` middleware guarding both `/sign-in/magic-link`
 * (so an ineligible address never receives an email and no verification row
 * is created) and `/magic-link/verify` (so eligibility lost after send still
 * blocks the login). Throws `APIError('BAD_REQUEST', { message: <code> })`
 * with codes from `AUTH_ERROR_CODES`.
 */
// The explicit return type keeps the emitted declaration portable: without
// it, tsc infers a type that references better-call (a transitive dependency
// of better-auth) and fails the build with TS2742 in isolated installs
// (e.g. pnpm's git-dependency prepare step).
export function createEligibilityHook(
  config: EligibilityHookConfig,
): AuthMiddleware {
  const handler = createEligibilityHandler(config);
  return createAuthMiddleware(async hookCtx => {
    await handler(hookCtx as unknown as EligibilityHookContext);
  });
}
