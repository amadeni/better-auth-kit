# @amadeni/better-auth-kit

Shared Better Auth base for Amadeni apps: Convex + Next.js, passwordless
magic link sign-in via Resend, closed registration with initial-admin
bootstrap.

The kit extracts the hardened reference implementation into reusable
building blocks:

- a hardened Better Auth options factory (`storeToken: 'hashed'`,
  database-backed rate limiting — not overridable)
- the branded German magic link email with the interstitial
  `/login?token=…` flow (mail scanners cannot consume tokens)
- eligibility hooks for `/sign-in/magic-link` **and** `/magic-link/verify`
- the lazy-linking `user.onCreate` trigger (app users table stays the
  source of truth)
- Next.js middleware, catch-all route handlers, and server helpers
- the fleet-wide email canonicalization and error codes with German
  client-side messages

## Install

```bash
pnpm add @amadeni/better-auth-kit better-auth@1.6.23 @convex-dev/better-auth@0.12.5 convex
```

`react` and `next` are optional peers — only needed for the `./client` and
`./next` entry points.

## Entry points

| Import                            | Runs in          | Contents                                                                      |
| --------------------------------- | ---------------- | ----------------------------------------------------------------------------- |
| `@amadeni/better-auth-kit`        | Convex functions | options factory, Resend sender, eligibility, lazy-link trigger, hashing, URLs |
| `@amadeni/better-auth-kit/client` | Browser/React    | auth client factory, sign-in error parsing + German messages                  |
| `@amadeni/better-auth-kit/next`   | Next.js server   | middleware, route decision, route handlers, auth server wrapper               |

The root entry never imports from `react` or `next`, so it is safe inside
the Convex component directory.

## Recommended Setup

The Better Auth component is installed locally in the app repo — this
scaffold stays in the app (generated code and app-specific wiring cannot
live in a package):

```
convex/
  auth.config.ts                 # getAuthConfigProvider()
  auth.ts                        # runtime instance (see below)
  betterAuth/
    convex.config.ts             # defineComponent('betterAuth')
    schema.ts                    # generated: npx auth generate --output ./schema.ts
    adapter.ts                   # createApi(schema, () => options)
    auth.ts                      # CLI-only betterAuth(options) for schema generation
    _generated/                  # convex codegen
src/
  middleware.ts
  app/api/auth/[...all]/route.ts
```

### `convex/betterAuth/authOptions.ts`

```ts
import { createAmadeniAuthOptions } from '@amadeni/better-auth-kit';
import type { BetterAuthOptions } from 'better-auth/minimal';

export const createAuthOptions = createAmadeniAuthOptions;

// Static options for schema generation and the component adapter only.
export const options = createAmadeniAuthOptions() as BetterAuthOptions;
```

### `convex/auth.ts`

```ts
import {
  AUTH_ERROR_CODES,
  canonicalizeAuthEmail,
  createAmadeniAuthOptions,
  createEligibilityHook,
  createLazyLinkTrigger,
  createResendMagicLinkSender,
  evaluateLoginEligibility,
} from '@amadeni/better-auth-kit';
import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config';
import { betterAuth } from 'better-auth/minimal';
import { components, internal } from './_generated/api';
import authSchema from './betterAuth/schema';

const linkUser = createLazyLinkTrigger({
  findAppUserByEmail: async (ctx, email) =>
    ctx.db
      .query('users')
      .withIndex('by_email', q => q.eq('email', email))
      .unique(),
  hasAnyAppUser: async ctx => (await ctx.db.query('users').first()) !== null,
  linkComponentUser: async (ctx, { authUserId, appUserId }) => {
    await ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: {
        model: 'user',
        where: [{ field: '_id', value: authUserId }],
        update: { userId: appUserId },
      },
    });
  },
  bootstrapInitialAdmin: async (ctx, { email }) =>
    ctx.db.insert('users', { email, role: 'admin' }),
});

export const authComponent = createClient(components.betterAuth, {
  local: { schema: authSchema },
  triggers: {
    user: {
      onCreate: async (ctx, authUser) => {
        await linkUser(ctx, authUser);
      },
    },
  },
  authFunctions: internal.auth,
});

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    ...createAmadeniAuthOptions({
      baseURL: process.env.SITE_URL,
      authConfig: { providers: [getAuthConfigProvider()] },
      sendMagicLink: createResendMagicLinkSender({
        brand: {
          productName: 'Example App',
          from: 'Example App <noreply@mail.example.com>',
        },
      }),
    }),
    database: authComponent.adapter(ctx),
    hooks: {
      before: createEligibilityHook({
        isEligible: async email =>
          'runQuery' in ctx
            ? ctx.runQuery(internal.auth.checkLoginEligibility, { email })
            : // Fail closed: a context that cannot run the check must not
              // let the request through.
              { ok: false, error: AUTH_ERROR_CODES.SIGN_IN_LINK_UNAVAILABLE },
      }),
    },
  });
```

Implement `checkLoginEligibility` as an `internalQuery` with
`evaluateLoginEligibility` — same closed-registration rules as the trigger,
checked _before_ the email is sent.

### `convex/auth.config.ts`

```ts
import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config';
import type { AuthConfig } from 'convex/server';

const authConfig = {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig;

export default authConfig;
```

### `src/middleware.ts`

```ts
import { createAuthNextMiddleware } from '@amadeni/better-auth-kit/next';

export default createAuthNextMiddleware();

// Next.js statically parses `config` at build time — the matcher MUST be an
// inline literal here; importing AUTH_MIDDLEWARE_MATCHER breaks `next build`.
export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
};
```

Keep the literal in sync with the kit via a drift-guard test:

```ts
// src/middleware.test.ts
import { AUTH_MIDDLEWARE_MATCHER } from '@amadeni/better-auth-kit/next';
import { config } from './middleware';

test('middleware matcher matches the kit constant', () => {
  expect(config.matcher).toEqual(AUTH_MIDDLEWARE_MATCHER);
});
```

### `src/app/api/auth/[...all]/route.ts`

```ts
import { createAuthRouteHandlers } from '@amadeni/better-auth-kit/next';
import { authServer } from '@/lib/auth-server';

export const { GET, POST } = createAuthRouteHandlers(authServer.handler);
```

### `src/lib/auth-server.ts` and `src/lib/auth-client.ts`

```ts
// auth-server.ts
import { createAuthServer } from '@amadeni/better-auth-kit/next';

export const authServer = createAuthServer({
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL!,
  convexSiteUrl: process.env.NEXT_PUBLIC_CONVEX_SITE_URL!,
});

// auth-client.ts
import { createAmadeniAuthClient } from '@amadeni/better-auth-kit/client';

export const authClient = createAmadeniAuthClient();
```

### Environment variables

| Variable                      | Where             | Purpose                                                             |
| ----------------------------- | ----------------- | ------------------------------------------------------------------- |
| `SITE_URL`                    | Convex deployment | Public app URL; base for magic link URLs                            |
| `BETTER_AUTH_SECRET`          | Convex deployment | Better Auth signing secret                                          |
| `AUTH_RESEND_KEY`             | Convex deployment | Resend API key (fallbacks: `AUTH_RESEND_API_KEY`, `RESEND_API_KEY`) |
| `INITIAL_ADMIN_EMAIL`         | Convex deployment | Bootstrap admin while the users table is empty                      |
| `NEXT_PUBLIC_CONVEX_URL`      | Next.js           | Convex deployment URL (`*.convex.cloud`)                            |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Next.js           | Convex HTTP actions URL (`*.convex.site`)                           |
| `AMADENI_DEV_AUTH_ENABLED`    | Convex deployment | **Dev deployments only** — enables deterministic dev logins         |

## Deterministic dev logins (`createDevAuth`)

> **WARNING:** `AMADENI_DEV_AUTH_ENABLED=true` turns deployment env access
> into login ability. It must NEVER be set on a production deployment.
> `assertDevAuthEnabled` additionally refuses production-shaped
> `CONVEX_DEPLOYMENT` values (`prod`, `prod:*`, `production:*`) even when
> the flag leaks — but the flag simply has no business existing on prod.

Automated pipelines (visual review, e2e, `@amadeni/dev-contract`) need a
login without an email round-trip. `createDevAuth` mints a single-use magic
link token and writes its **hashed** verification row directly into the
Better Auth component — the regular `/api/auth/magic-link/verify` endpoint
then completes the sign-in with real sessions and real cookies. No
auth-config deviation, nothing to clean up.

```ts
// convex/dev/auth.ts — app wiring (generic factory, injected persistence)
import { v } from 'convex/values';
import {
  createDevAuth,
  requireDevAuthCliIdentity,
} from '@amadeni/better-auth-kit';
import { action, internalMutation } from '../_generated/server';
import { components, internal } from '../_generated/api';

const devAuth = createDevAuth({
  createVerification: (ctx, input) =>
    ctx.runMutation(components.betterAuth.adapter.create, { input }),
  // Ensure the app user exists and is eligible BEFORE the token is minted,
  // otherwise the verify-time eligibility hook denies the login.
  ensureUser: (ctx, { email, name }) =>
    ctx.runMutation(internal.dev.auth.ensureDevUserInternal, { email, name }),
  defaultEmail: 'dev@amadeni.local',
});

export const createDevToken = action({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // CLI-only surface: `convex run --identity '{"issuer": ..., "subject": ...}'`
    await requireDevAuthCliIdentity(ctx, {
      issuer: 'my-app-dev-auth',
      subject: 'dev-auth-cli',
    });
    return await devAuth.issueToken(ctx, args); // gate + user + token
  },
});
```

Consume the token via `devAuth.buildVerifyUrl({ token, origin })` — a
`fetch(url, { redirect: 'manual' })` returns the session cookies
(`better-auth.session_token`, `better-auth.convex_jwt`) in `Set-Cookie`.
`@amadeni/dev-contract` packages exactly this flow as a CLI with a
verified-login readiness gate.

## Resilient Convex token refresh (`createConvexTokenManager`)

After laptop standby or a background tab the Convex JWT expires; on wake
the Convex reconnect races the token refresh, `getSession`-style requests
can hang on a half-dead network, and the Convex client never retries once
a token fetch returned `null` — users see error pages or a stuck
"renewing sign-in" screen until they reload. The `/client` token manager
fixes this fleet-wide:

- **Proactive refresh** on `visibilitychange` → visible and `online`
  events plus a background interval — the token is fresh again before
  Convex reconnects.
- **Stale-while-revalidate + backoff**: a not-yet-expired token keeps
  being served while refreshes retry (1s/2s/5s/15s, each attempt capped
  by a timeout). Unauthenticated is reported only once the token expired
  AND retries are exhausted — or the backend answers 401/403.
- **Automatic recovery**: after Convex gave up (saw `null`), the next
  successful refresh bumps an auth epoch, which rotates the
  `fetchAccessToken` identity and makes `ConvexProviderWithAuth` call
  `client.setAuth` again — the automated version of "reload fixes it".

```tsx
// src/lib/convex-token.ts
import {
  createBetterAuthTokenFetcher,
  createConvexAuthHooks,
  createConvexTokenManager,
} from '@amadeni/better-auth-kit/client';
import { authClient } from './auth-client';

export const tokenManager = createConvexTokenManager({
  fetchToken: createBetterAuthTokenFetcher(authClient),
});
export const { useAuth, useAuthToken } = createConvexAuthHooks(tokenManager);

// src/app/ConvexClientProvider.tsx
<ConvexProviderWithAuth client={convex} useAuth={useAuth}>

// Imperative consumers (HTTP uploads etc.):
const token = await tokenManager.getToken({ forceRefresh: gotA401 });

// Intermediate states become visible only after a few seconds:
const showPending = useDelayedAuthPending(authLost, 3_000);
```

Seed the SSR token with `tokenManager.prime(initialToken)`; call
`tokenManager.clear()` on explicit sign-out.

## Security

This package is the auth base of the whole fleet, which makes it a
supply-chain target. Deliberate posture:

- **Zero runtime dependencies.** Everything is a peer dependency the app
  already ships. No postinstall scripts, no telemetry, and no network calls
  except the single explicit `fetch` to `https://api.resend.com/emails` in
  `createResendMagicLinkSender`.
- **Exact peer pins for the auth stack.** `better-auth@1.6.23` and
  `@convex-dev/better-auth@0.12.5` are pinned exactly: the kit mirrors
  internals of these versions (token hashing, verification storage,
  internal adapter lookups), and silent minor upgrades of an auth library
  are a risk, not a feature. Upgrades happen as deliberate kit releases.
- **Consumers cannot weaken the core.** `createAmadeniAuthOptions` always
  sets `storeToken: 'hashed'` (a database leak must not leak live sign-in
  tokens) and `rateLimit: { storage: 'database' }` (in-memory rate limiting
  never fires on the stateless Convex runtime). The magic link and convex
  plugins are always wired and cannot be replaced through `extraPlugins`:
  Better Auth merges plugin endpoints last-wins (and only logs endpoint
  conflicts), so the kit orders its plugins last and additionally throws if
  an extra plugin carries the reserved id `magic-link` or `convex`.
- **No open redirect through the envelope unwrap.** `unwrapRedirectEnvelope`
  only issues redirects to the request's own origin (or origins explicitly
  allow-listed via `allowedRedirectOrigins`); cross-origin envelopes pass
  through unchanged.
- **Scanner-proof links.** Emails link to the `/login?token=…` interstitial;
  only an explicit user click consumes the token at the verify endpoint.
- **Fail-closed verify re-check.** `createEligibilityHook` re-validates
  eligibility on `/magic-link/verify` via the hashed-token lookup, so a user
  deleted after the email was sent cannot complete the sign-in.

## Development

```bash
pnpm install
pnpm run ci    # prettier + eslint + tsc + cspell + vitest
```

Releases: `pnpm run release` (patch), `release:minor`, `release:major`.
