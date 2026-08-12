// Framework-free Convex auth token manager. React glue lives in
// `convexAuthHooks.ts`; this file must stay importable without React.

/** Argument shape of Convex's `AuthTokenFetcher` (see `convex/browser`). */
export type FetchAccessTokenArgs = { forceRefreshToken?: boolean };

/**
 * Immutable state snapshot for `useSyncExternalStore` consumers.
 *
 * `token` semantics:
 * - `undefined` — never resolved (initial load still pending)
 * - `string`    — usable token (possibly stale while a refresh retries)
 * - `null`      — definitively signed out, or expired with retries exhausted
 */
export type ConvexTokenSnapshot = {
  token: string | null | undefined;
  /** True while a refresh (including backoff waits between retries) runs. */
  isRefreshing: boolean;
  /**
   * Increments when a refresh succeeds after the manager had reported
   * `null`. Consumers key their `fetchAccessToken` identity on this so
   * `ConvexProviderWithAuth` calls `client.setAuth` again — the Convex
   * client never retries by itself once a token fetch returned `null`.
   */
  authEpoch: number;
};

export type ConvexTokenManagerConfig = {
  /**
   * Fetches a fresh Convex JWT. Resolve `null` for "definitively signed
   * out" (ends retries immediately); throw for transient failures (network
   * down, 5xx) so the manager retries with backoff. Usually
   * `createBetterAuthTokenFetcher(authClient)`.
   */
  fetchToken: () => Promise<string | null>;
  /**
   * Abort a single fetch attempt after this long — `getSession`/token
   * requests can hang forever on a network that died mid-standby.
   * Default 10s.
   */
  fetchTimeoutMs?: number;
  /**
   * Waits between failed attempts. Attempts = 1 + `retryDelaysMs.length`.
   * Default `[1000, 2000, 5000, 15000]`. Wake events cut a wait short.
   */
  retryDelaysMs?: readonly number[];
  /** Proactive background refresh period while started. Default 5min. */
  refreshIntervalMs?: number;
  /** Treat a token as expired this long before its JWT `exp`. Default 30s. */
  expiryLeewayMs?: number;
  /** Assumed lifetime when the token carries no parsable `exp`. Default 5min. */
  fallbackTokenTtlMs?: number;
  /**
   * A token fetched at most this long ago satisfies even a
   * `forceRefreshToken` request. Dedupes the wake-up burst where the
   * proactive refresh and Convex's reconnect race each other. Default 5s.
   */
  reuseRecentTokenOnForceMs?: number;
  /**
   * Refresh proactively on wake when the token expires within this window
   * (in addition to age > `refreshIntervalMs`). Default 2min.
   */
  proactiveRefreshWindowMs?: number;
  /**
   * Wires wake signals (defaults to `visibilitychange` → visible and
   * `online` in the browser). Injectable for tests and non-DOM hosts.
   * Returns a detach function.
   */
  attachWakeListeners?: (onWake: () => void) => () => void;
};

type RefreshOutcome = 'token' | 'signed-out' | 'failed';

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 15_000] as const;
const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60_000;
const DEFAULT_EXPIRY_LEEWAY_MS = 30_000;
const DEFAULT_FALLBACK_TOKEN_TTL_MS = 5 * 60_000;
const DEFAULT_REUSE_RECENT_ON_FORCE_MS = 5_000;
const DEFAULT_PROACTIVE_WINDOW_MS = 2 * 60_000;

/** Best-effort read of a JWT's `exp` claim in epoch milliseconds. */
export function decodeJwtExpiryMs(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims: unknown = JSON.parse(atob(base64));
    if (
      typeof claims === 'object' &&
      claims !== null &&
      'exp' in claims &&
      typeof claims.exp === 'number'
    ) {
      return claims.exp * 1000;
    }
    return null;
  } catch {
    return null;
  }
}

function attachBrowserWakeListeners(onWake: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      onWake();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('online', onWake);
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('online', onWake);
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`better-auth-kit: token fetch timed out after ${ms}ms`));
    }, ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export type ConvexTokenManager = ReturnType<typeof createConvexTokenManager>;

/**
 * Caches the Convex JWT and keeps it fresh across laptop standby and
 * background tabs: proactive refresh on wake/online events plus an
 * interval, stale-while-revalidate with bounded backoff on failures, and a
 * timeout around every fetch so a hanging session request can never freeze
 * consumers. Reports `null` (unauthenticated) only once the token is
 * expired AND retries are exhausted — or the backend definitively says
 * there is no session.
 *
 * One manager instance per app (module scope), shared by the Convex
 * provider hook, HTTP upload helpers, and anything else needing the token.
 */
export function createConvexTokenManager(config: ConvexTokenManagerConfig) {
  const fetchTimeoutMs = config.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const retryDelaysMs = config.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const refreshIntervalMs =
    config.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  const expiryLeewayMs = config.expiryLeewayMs ?? DEFAULT_EXPIRY_LEEWAY_MS;
  const fallbackTokenTtlMs =
    config.fallbackTokenTtlMs ?? DEFAULT_FALLBACK_TOKEN_TTL_MS;
  const reuseRecentTokenOnForceMs =
    config.reuseRecentTokenOnForceMs ?? DEFAULT_REUSE_RECENT_ON_FORCE_MS;
  const proactiveRefreshWindowMs =
    config.proactiveRefreshWindowMs ?? DEFAULT_PROACTIVE_WINDOW_MS;
  const attachWakeListeners =
    config.attachWakeListeners ?? attachBrowserWakeListeners;

  let token: string | null | undefined = undefined;
  let fetchedAt = 0;
  let expiresAt = 0;
  let authEpoch = 0;
  let refreshPromise: Promise<RefreshOutcome> | null = null;
  let interruptBackoff: (() => void) | null = null;
  /** Bumped by `prime`/`clear` so an in-flight refresh cannot apply late. */
  let resetSeq = 0;
  /**
   * Last stale token already served to a `forceRefreshToken` request while
   * refreshing failed — never serve the same one twice, the server already
   * rejected it (avoids a reconnect loop).
   */
  let lastStaleServedOnForce: string | null = null;
  /**
   * True once `fetchAccessToken` resolved `null` for Convex — from then on
   * the Convex client has given up for good, so the next successful
   * refresh must bump the epoch to trigger a fresh `setAuth`.
   */
  let convexSawNull = false;
  let startCount = 0;
  let detach: (() => void) | null = null;

  const listeners = new Set<() => void>();
  let snapshot: ConvexTokenSnapshot = {
    token: undefined,
    isRefreshing: false,
    authEpoch: 0,
  };

  function publish() {
    const next: ConvexTokenSnapshot = {
      token,
      isRefreshing: refreshPromise !== null,
      authEpoch,
    };
    if (
      next.token === snapshot.token &&
      next.isRefreshing === snapshot.isRefreshing &&
      next.authEpoch === snapshot.authEpoch
    ) {
      return;
    }
    snapshot = next;
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function hasUsableToken(): boolean {
    return typeof token === 'string' && Date.now() < expiresAt;
  }

  function applyToken(next: string) {
    const recovered = token === null || convexSawNull;
    convexSawNull = false;
    token = next;
    fetchedAt = Date.now();
    const decodedExpiry = decodeJwtExpiryMs(next);
    expiresAt =
      decodedExpiry !== null
        ? decodedExpiry - expiryLeewayMs
        : fetchedAt + fallbackTokenTtlMs;
    lastStaleServedOnForce = null;
    if (recovered) {
      authEpoch += 1;
    }
    publish();
  }

  function markSignedOut() {
    token = null;
    publish();
  }

  async function runRefresh(): Promise<RefreshOutcome> {
    const seqAtStart = resetSeq;
    for (let attempt = 0; ; attempt++) {
      try {
        const next = await withTimeout(config.fetchToken(), fetchTimeoutMs);
        if (seqAtStart !== resetSeq) {
          return 'failed';
        }
        if (typeof next === 'string' && next.length > 0) {
          applyToken(next);
          return 'token';
        }
        markSignedOut();
        return 'signed-out';
      } catch {
        if (seqAtStart !== resetSeq) {
          return 'failed';
        }
        if (attempt >= retryDelaysMs.length) {
          if (!hasUsableToken()) {
            // Expired (or never had a token) and out of retries: only now
            // give up and report unauthenticated.
            markSignedOut();
          }
          return 'failed';
        }
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => {
            interruptBackoff = null;
            resolve();
          }, retryDelaysMs[attempt]);
          interruptBackoff = () => {
            clearTimeout(timer);
            interruptBackoff = null;
            resolve();
          };
        });
      }
    }
  }

  /** Single-flight refresh; concurrent callers share one attempt chain. */
  function refresh(): Promise<RefreshOutcome> {
    if (refreshPromise) {
      return refreshPromise;
    }
    refreshPromise = runRefresh().finally(() => {
      refreshPromise = null;
      publish();
    });
    publish();
    return refreshPromise;
  }

  function isRecentEnoughForForce(): boolean {
    return (
      typeof token === 'string' &&
      Date.now() < expiresAt &&
      Date.now() - fetchedAt < reuseRecentTokenOnForceMs
    );
  }

  /**
   * Resolves a token for imperative consumers (HTTP uploads etc.).
   * `forceRefresh` skips the freshness check (e.g. after a 401), but a
   * token fetched within `reuseRecentTokenOnForceMs` is returned as-is.
   * Falls back to the stale-but-unexpired token when the refresh fails.
   */
  async function getToken({
    forceRefresh = false,
  }: { forceRefresh?: boolean } = {}): Promise<string | null> {
    if (forceRefresh ? isRecentEnoughForForce() : hasUsableToken()) {
      return token as string;
    }
    const outcome = await refresh();
    if (outcome === 'token' || hasUsableToken()) {
      return token as string;
    }
    return null;
  }

  /**
   * Convex `AuthTokenFetcher` — hand this to `ConvexProviderWithAuth` (via
   * the hook factory). Same contract as `getToken`, plus a guard: a stale
   * token is served to a `forceRefreshToken` request at most once, because
   * force-refresh implies the server may have just rejected it.
   */
  async function fetchAccessToken({
    forceRefreshToken = false,
  }: FetchAccessTokenArgs = {}): Promise<string | null> {
    if (forceRefreshToken ? isRecentEnoughForForce() : hasUsableToken()) {
      return token as string;
    }
    const outcome = await refresh();
    if (outcome === 'token') {
      return token as string;
    }
    if (outcome === 'failed' && hasUsableToken()) {
      const stale = token as string;
      if (!forceRefreshToken) {
        return stale;
      }
      if (lastStaleServedOnForce !== stale) {
        lastStaleServedOnForce = stale;
        return stale;
      }
    }
    convexSawNull = true;
    return null;
  }

  /**
   * Proactive path for wake signals and the interval: refresh before Convex
   * reconnects or a consumer runs into an expired token. No-op while a
   * refresh is in flight (but cuts a backoff wait short) and when the token
   * is fresh enough.
   */
  function ensureFreshToken() {
    if (refreshPromise) {
      interruptBackoff?.();
      return;
    }
    if (typeof token === 'string') {
      const expiringSoon = Date.now() >= expiresAt - proactiveRefreshWindowMs;
      const aging = Date.now() - fetchedAt >= refreshIntervalMs;
      if (!expiringSoon && !aging) {
        return;
      }
    }
    // token undefined (never loaded), null (recovery chance), or due.
    void refresh();
  }

  /**
   * Seed the cache, e.g. with a server-rendered initial token. Does not
   * bump the auth epoch — priming happens before Convex ever saw `null`.
   */
  function prime(initialToken: string | null | undefined) {
    if (initialToken === undefined || initialToken === token) {
      return;
    }
    resetSeq += 1;
    if (initialToken === null) {
      markSignedOut();
      return;
    }
    applyToken(initialToken);
  }

  /** Drop the cached token, e.g. after an explicit sign-out. */
  function clear() {
    resetSeq += 1;
    lastStaleServedOnForce = null;
    markSignedOut();
  }

  /**
   * Attach wake listeners + refresh interval and trigger an initial
   * `ensureFreshToken`. Ref-counted: returns a stop function; listeners
   * detach when the last starter stops.
   */
  function start(): () => void {
    startCount += 1;
    if (startCount === 1) {
      const detachWake = attachWakeListeners(ensureFreshToken);
      const intervalId = setInterval(ensureFreshToken, refreshIntervalMs);
      detach = () => {
        detachWake();
        clearInterval(intervalId);
      };
      ensureFreshToken();
    }
    let stopped = false;
    return () => {
      if (stopped) {
        return;
      }
      stopped = true;
      startCount -= 1;
      if (startCount === 0) {
        detach?.();
        detach = null;
      }
    };
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot(): ConvexTokenSnapshot {
    return snapshot;
  }

  /** Current token without triggering any fetch. */
  function peekToken(): string | null | undefined {
    return token;
  }

  return {
    prime,
    clear,
    getToken,
    fetchAccessToken,
    ensureFreshToken,
    start,
    subscribe,
    getSnapshot,
    peekToken,
  };
}

type BetterAuthTokenErrorShape = {
  status?: number;
  message?: string;
} | null;

/**
 * Structural slice of a better-auth client with the convex plugin — only
 * `convex.token` is needed, so consumers can pass their app's client
 * without fighting plugin type inference.
 */
export type ConvexTokenAuthClient = {
  convex: {
    token: (options?: { fetchOptions?: { throw?: boolean } }) => Promise<{
      data?: { token?: string } | null;
      error?: BetterAuthTokenErrorShape;
    }>;
  };
};

/**
 * Adapts `authClient.convex.token()` to the manager's `fetchToken`
 * contract: 401/403 (no session) resolves `null` so retries stop, any
 * other failure throws so the manager retries with backoff.
 */
export function createBetterAuthTokenFetcher(
  authClient: ConvexTokenAuthClient,
): () => Promise<string | null> {
  return async () => {
    const { data, error } = await authClient.convex.token({
      fetchOptions: { throw: false },
    });
    if (error) {
      if (error.status === 401 || error.status === 403) {
        return null;
      }
      throw new Error(
        `better-auth-kit: convex token request failed (status ${String(
          error.status ?? 'unknown',
        )})`,
      );
    }
    return data?.token ?? null;
  };
}
