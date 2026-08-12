import { convexAdapter } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import type { BetterAuthOptions } from 'better-auth/minimal';
import { magicLink } from 'better-auth/plugins/magic-link';
import type { AuthConfig } from 'convex/server';

export const MAGIC_LINK_TTL_SECONDS = 60 * 60 * 24; // 24h
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30d

export type SendMagicLink = (data: {
  email: string;
  token: string;
  url: string;
}) => Promise<void>;

type ExtraPlugins = NonNullable<BetterAuthOptions['plugins']>;

export type AmadeniAuthOptionsConfig<
  TExtra extends ExtraPlugins = ExtraPlugins,
> = {
  /** Public site URL (`process.env.SITE_URL` at runtime). */
  baseURL?: string;
  /** Human-readable app name, forwarded to Better Auth's `appName`. */
  appName?: string;
  /**
   * Convex auth config for the convex plugin. At runtime pass
   * `{ providers: [getAuthConfigProvider()] }`; schema generation and the
   * component adapter fall back to a placeholder provider.
   */
  authConfig?: AuthConfig;
  /** Delivery for the magic link email — see `createResendMagicLinkSender`. */
  sendMagicLink?: SendMagicLink;
  /** Session lifetime; defaults to 30 days. */
  sessionTtlSeconds?: number;
  /** Magic link lifetime; defaults to 24 hours. */
  magicLinkTtlSeconds?: number;
  /**
   * Additional Better Auth plugins (OAuth provider, org plugin, …). They are
   * inserted between the kit's magic link and convex plugins and cannot
   * replace either of them.
   */
  extraPlugins?: TExtra;
};

/**
 * Hardened Better Auth options shared by every Amadeni app.
 *
 * Non-negotiable defaults a consumer cannot turn off through this factory:
 * - `storeToken: 'hashed'` — a database leak does not leak live sign-in
 *   tokens.
 * - `rateLimit: { storage: 'database' }` — the Convex runtime is stateless
 *   per request, so Better Auth's default in-memory rate limiting would
 *   never see a second attempt.
 * - magic link and convex plugins are always wired.
 *
 * This is a function (and reads no environment variables at module scope) so
 * it stays usable inside the Convex component directory, where env vars are
 * unavailable: schema generation and the component adapter call it with no
 * arguments.
 */
export type AmadeniAuthOptions<TExtra extends ExtraPlugins = never[]> = {
  database: ReturnType<typeof convexAdapter>;
  baseURL?: string;
  appName?: string;
  session: { expiresIn: number };
  rateLimit: { storage: 'database' };
  plugins: (
    ReturnType<typeof magicLink> | TExtra[number] | ReturnType<typeof convex>
  )[];
};

export const createAmadeniAuthOptions = <TExtra extends ExtraPlugins = never[]>(
  config: AmadeniAuthOptionsConfig<TExtra> = {},
): AmadeniAuthOptions<TExtra> =>
  // Deliberately not asserted to `BetterAuthOptions` — the plugin types must
  // survive so `auth.api` exposes the plugin endpoints. For schema
  // generation, assert the result yourself:
  // `createAmadeniAuthOptions() as BetterAuthOptions`.
  ({
    // Placeholder adapter for schema generation; the runtime instance
    // replaces `database` with the real ctx-bound component adapter.
    database: convexAdapter({} as never, {} as never),
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.appName ? { appName: config.appName } : {}),
    session: { expiresIn: config.sessionTtlSeconds ?? SESSION_TTL_SECONDS },
    rateLimit: { storage: 'database' as const },
    plugins: [
      magicLink({
        expiresIn: config.magicLinkTtlSeconds ?? MAGIC_LINK_TTL_SECONDS,
        storeToken: 'hashed',
        sendMagicLink: config.sendMagicLink ?? (async () => {}),
      }),
      ...((config.extraPlugins ?? []) as TExtra),
      convex({
        authConfig: config.authConfig ?? {
          providers: [{ applicationID: 'convex', domain: '' }],
        },
      }),
    ],
  });
