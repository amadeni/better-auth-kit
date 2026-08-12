import { canonicalizeAuthEmail } from './canonicalizeEmail.js';
import { hashVerificationToken } from './hashToken.js';
import { buildMagicLinkVerifyUrl } from './urls.js';

/**
 * The single opt-in switch for deterministic dev logins. Must be set to the
 * exact string `true` on the Convex DEV deployment — and must NEVER be set
 * on a production deployment. `assertDevAuthEnabled` refuses
 * production-shaped `CONVEX_DEPLOYMENT` values even when the flag is set.
 */
export const DEV_AUTH_ENV_NAME = 'AMADENI_DEV_AUTH_ENABLED';

/** Default TTL for a dev login token: 10 minutes, mirrors magic links. */
export const DEV_AUTH_TOKEN_TTL_MS = 10 * 60 * 1000;

export type DevAuthEnv = Record<string, string | undefined>;

function looksLikeProductionDeployment(deployment: string) {
  return /^prod(uction)?(:|$)/i.test(deployment.trim());
}

/**
 * Hard gate for every dev-auth code path.
 *
 * Throws unless `AMADENI_DEV_AUTH_ENABLED` is the exact string `true`, and
 * ALWAYS throws when `CONVEX_DEPLOYMENT` looks like a production deployment
 * (`prod`, `prod:*`, `production:*`, case-insensitive) — a leaked flag on
 * production must not open a login bypass.
 */
export function assertDevAuthEnabled(env: DevAuthEnv = process.env) {
  const deployment = env.CONVEX_DEPLOYMENT ?? '';
  if (looksLikeProductionDeployment(deployment)) {
    throw new Error(
      'Dev auth is never available on production deployments ' +
        `(CONVEX_DEPLOYMENT=${deployment}).`,
    );
  }
  if (env[DEV_AUTH_ENV_NAME] !== 'true') {
    throw new Error(
      `Dev auth is disabled: set ${DEV_AUTH_ENV_NAME}=true on the Convex ` +
        'dev deployment. Never set it on production.',
    );
  }
}

/**
 * High-entropy single-use token value (2x UUID v4, ~244 bits). The raw
 * token is returned to the caller; only its hash is persisted.
 */
export function createDevAuthTokenValue() {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

/**
 * Guard for the public `convex run --identity` entry point: the CLI calls
 * the app's dev-auth action with a synthetic identity
 * (`convex run --identity '{"issuer": ..., "subject": ...}'`), and the
 * action rejects everything else. Not a cryptographic boundary — the real
 * gate is `assertDevAuthEnabled` — but it keeps the action unusable from
 * browsers and regular user sessions.
 */
export async function requireDevAuthCliIdentity(
  ctx: {
    auth: {
      getUserIdentity: () => Promise<{
        issuer?: string;
        subject?: string;
      } | null>;
    };
  },
  expected: { issuer: string; subject: string },
) {
  const identity = await ctx.auth.getUserIdentity();
  if (
    identity?.issuer !== expected.issuer ||
    identity.subject !== expected.subject
  ) {
    throw new Error('Dev auth CLI identity required.');
  }
}

/**
 * The verification row the magic link plugin expects, byte-compatible with
 * what `storeToken: 'hashed'` writes: the row is stored under the token
 * HASH, `value` carries the JSON payload the verify endpoint parses.
 * Passed verbatim as `input` to the Better Auth component's
 * `adapter.create` mutation.
 */
export type DevAuthVerificationInput = {
  model: 'verification';
  data: {
    identifier: string;
    value: string;
    expiresAt: number;
    createdAt: number;
    updatedAt: number;
  };
};

export type DevAuthConfig<Ctx> = {
  /**
   * Persists the verification row into the Better Auth component. Apps
   * pass the component adapter, typically:
   *
   * `(ctx, input) => ctx.runMutation(components.betterAuth.adapter.create, { input })`
   */
  createVerification: (
    ctx: Ctx,
    input: DevAuthVerificationInput,
  ) => Promise<unknown>;
  /**
   * Ensures the app user for the dev email exists (and is eligible) BEFORE
   * the token is minted — otherwise the verify-time eligibility hook
   * denies the login. App-specific: create/undelete the user in the app's
   * users table.
   */
  ensureUser?: (
    ctx: Ctx,
    args: { email: string; name: string },
  ) => Promise<unknown>;
  /** Email used when the caller does not pass one. */
  defaultEmail?: string;
  /** Display name written into the verification payload / created user. */
  userName?: string;
  /** Token lifetime; defaults to `DEV_AUTH_TOKEN_TTL_MS` (10 minutes). */
  tokenTtlMs?: number;
  /** Email equality; defaults to `canonicalizeAuthEmail`. */
  canonicalize?: (email: string) => string;
  /** Environment source; defaults to `process.env` (test seam). */
  env?: DevAuthEnv;
  /** Clock; defaults to `Date.now` (test seam). */
  now?: () => number;
};

/**
 * Factory for the Convex-side building blocks of deterministic dev logins
 * (no email round-trip): mint a single-use magic link token, write its
 * hashed verification row directly into the Better Auth component, and let
 * the regular `/api/auth/magic-link/verify` endpoint complete the sign-in —
 * no auth-config deviation, real sessions, real cookies.
 *
 * Fully generic: no imports from any app's `_generated` — all persistence
 * goes through the injected callbacks. Every minting path is gated by
 * `assertDevAuthEnabled`.
 *
 * SECURITY: `AMADENI_DEV_AUTH_ENABLED=true` turns possession of deployment
 * env access into login ability. Only ever set it on local/dev
 * deployments; never on production.
 */
export function createDevAuth<Ctx>(config: DevAuthConfig<Ctx>) {
  const canonicalize = config.canonicalize ?? canonicalizeAuthEmail;
  const defaultEmail = config.defaultEmail ?? 'dev@amadeni.local';
  const userName = config.userName ?? 'Amadeni Dev';
  const tokenTtlMs = config.tokenTtlMs ?? DEV_AUTH_TOKEN_TTL_MS;
  const env = config.env ?? process.env;
  const now = config.now ?? Date.now;

  const resolveEmail = (email?: string | null) =>
    canonicalize(email || defaultEmail);

  return {
    /** Re-exported gate bound to this factory's env source. */
    assertEnabled: () => assertDevAuthEnabled(env),

    /**
     * Mints a dev login token: gate check, ensure the (eligible) app user,
     * write the hashed verification row. Returns the RAW token — consume
     * it via the magic link verify endpoint (`buildVerifyUrl`).
     */
    issueToken: async (
      ctx: Ctx,
      args?: { email?: string | null },
    ): Promise<{ token: string; email: string }> => {
      assertDevAuthEnabled(env);
      const email = resolveEmail(args?.email);
      await config.ensureUser?.(ctx, { email, name: userName });

      const token = createDevAuthTokenValue();
      const timestamp = now();
      await config.createVerification(ctx, {
        model: 'verification',
        data: {
          identifier: await hashVerificationToken(token),
          value: JSON.stringify({ email, name: userName }),
          expiresAt: timestamp + tokenTtlMs,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });
      return { token, email };
    },

    /**
     * Verify URL that consumes the token and issues the session cookies.
     * Thin wrapper over `buildMagicLinkVerifyUrl` so consumers do not need
     * a second import.
     */
    buildVerifyUrl: (args: {
      token: string;
      callbackURL?: string;
      errorCallbackURL?: string;
      origin?: string;
      authApiBasePath?: string;
    }) => buildMagicLinkVerifyUrl(args),

    /** The canonical email a given input resolves to (default applied). */
    resolveEmail,
  };
}
