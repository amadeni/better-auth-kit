import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBetterAuthTokenFetcher,
  createConvexTokenManager,
  decodeJwtExpiryMs,
  type ConvexTokenManagerConfig,
} from './convexTokenManager.js';

/** Unsigned JWT-shaped token with the given `exp` (epoch ms). */
function makeJwt(expMs: number, marker = 'a'): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(expMs / 1000), marker }),
  ).toString('base64url');
  return `header.${payload}.signature`;
}

function createHarness(overrides: Partial<ConvexTokenManagerConfig> = {}) {
  const fetchToken = vi.fn<() => Promise<string | null>>();
  let wake: () => void = () => {};
  const manager = createConvexTokenManager({
    fetchToken,
    attachWakeListeners: onWake => {
      wake = onWake;
      return () => {};
    },
    ...overrides,
  });
  return { manager, fetchToken, triggerWake: () => wake() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('decodeJwtExpiryMs', () => {
  it('reads the exp claim in milliseconds', () => {
    expect(decodeJwtExpiryMs(makeJwt(1_234_567_000))).toBe(1_234_567_000);
  });

  it('returns null for opaque tokens', () => {
    expect(decodeJwtExpiryMs('not-a-jwt')).toBeNull();
    expect(decodeJwtExpiryMs('a.b$c!.c')).toBeNull();
  });
});

describe('createConvexTokenManager', () => {
  it('serves the cached token without fetching while it is fresh', async () => {
    const { manager, fetchToken } = createHarness();
    manager.prime(makeJwt(Date.now() + 3_600_000));

    const token = await manager.fetchAccessToken({});

    expect(token).toBe(makeJwt(Date.now() + 3_600_000));
    expect(fetchToken).not.toHaveBeenCalled();
  });

  it('wake-up: refreshes an expired token on visibilitychange before any consumer asks', async () => {
    const { manager, fetchToken, triggerWake } = createHarness();
    manager.prime(makeJwt(Date.now() + 3_600_000));
    manager.start();

    // Laptop standby: wake up long after the token expired.
    vi.setSystemTime(Date.now() + 2 * 3_600_000);
    const fresh = makeJwt(Date.now() + 3_600_000, 'fresh');
    fetchToken.mockResolvedValue(fresh);
    triggerWake();
    await vi.advanceTimersByTimeAsync(0);

    // The proactive refresh already ran — the consumer gets the fresh
    // token from cache, no second fetch.
    expect(fetchToken).toHaveBeenCalledTimes(1);
    const token = await manager.fetchAccessToken({ forceRefreshToken: true });
    expect(token).toBe(fresh);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it('hang: times out a never-resolving fetch and retries with backoff', async () => {
    const { manager, fetchToken } = createHarness();
    const fresh = makeJwt(Date.now() + 3_600_000, 'after-hang');
    fetchToken
      .mockImplementationOnce(() => new Promise<never>(() => {}))
      .mockResolvedValueOnce(fresh);

    const pending = manager.fetchAccessToken({});
    // Attempt 1 hangs → 10s timeout, then 1s backoff → attempt 2 succeeds.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchToken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toBe(fresh);
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('stale-while-revalidate: keeps serving the unexpired token while refreshes fail', async () => {
    const { manager, fetchToken } = createHarness({
      reuseRecentTokenOnForceMs: 0,
    });
    const stale = makeJwt(Date.now() + 3_600_000, 'stale');
    manager.prime(stale);
    fetchToken.mockRejectedValue(new Error('offline'));

    const pending = manager.fetchAccessToken({ forceRefreshToken: true });
    // Exhaust all retries: backoff waits 1s + 2s + 5s + 15s.
    await vi.advanceTimersByTimeAsync(23_000);

    await expect(pending).resolves.toBe(stale);
    expect(fetchToken).toHaveBeenCalledTimes(5);
    // Still authenticated: the token itself has not expired.
    expect(manager.getSnapshot().token).toBe(stale);
  });

  it('permanent failure: reports unauthenticated only once expired and out of retries', async () => {
    const { manager, fetchToken } = createHarness();
    manager.prime(makeJwt(Date.now() + 60_000));
    fetchToken.mockRejectedValue(new Error('offline'));

    // Token expires (30s leeway) while the network stays down.
    vi.setSystemTime(Date.now() + 120_000);
    const pending = manager.fetchAccessToken({});
    await vi.advanceTimersByTimeAsync(23_000);

    await expect(pending).resolves.toBeNull();
    expect(manager.getSnapshot().token).toBeNull();
  });

  it('signed out: a null fetch result ends retries immediately', async () => {
    const { manager, fetchToken } = createHarness();
    fetchToken.mockResolvedValue(null);

    await expect(manager.fetchAccessToken({})).resolves.toBeNull();
    expect(fetchToken).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot().token).toBeNull();
  });

  it('recovery: bumps the auth epoch when a refresh succeeds after Convex saw null', async () => {
    const { manager, fetchToken, triggerWake } = createHarness();
    manager.prime(makeJwt(Date.now() + 3_600_000));
    manager.start();
    expect(manager.getSnapshot().authEpoch).toBe(0);

    // Wake up with an expired token while offline → retries exhaust →
    // Convex is told "unauthenticated" and gives up for good.
    vi.setSystemTime(Date.now() + 2 * 3_600_000);
    fetchToken.mockRejectedValue(new Error('offline'));
    const pending = manager.fetchAccessToken({ forceRefreshToken: true });
    await vi.advanceTimersByTimeAsync(23_000);
    await expect(pending).resolves.toBeNull();

    // Network returns: the online-event refresh succeeds and bumps the
    // epoch → consumers hand Convex a new fetchAccessToken → setAuth.
    const fresh = makeJwt(Date.now() + 3_600_000, 'recovered');
    fetchToken.mockResolvedValue(fresh);
    triggerWake();
    await vi.advanceTimersByTimeAsync(0);

    expect(manager.getSnapshot().token).toBe(fresh);
    expect(manager.getSnapshot().authEpoch).toBe(1);
  });

  it('serves a stale token to a force refresh at most once', async () => {
    const { manager, fetchToken } = createHarness({
      retryDelaysMs: [],
      reuseRecentTokenOnForceMs: 0,
    });
    const stale = makeJwt(Date.now() + 3_600_000, 'rejected');
    manager.prime(stale);
    fetchToken.mockRejectedValue(new Error('offline'));

    // First force refresh: the server may just be reconnecting — try the
    // stale token once more.
    await expect(
      manager.fetchAccessToken({ forceRefreshToken: true }),
    ).resolves.toBe(stale);
    // Second force refresh means the server rejected exactly that token:
    // do not loop, report null instead.
    await expect(
      manager.fetchAccessToken({ forceRefreshToken: true }),
    ).resolves.toBeNull();
  });

  it('dedupes the wake burst: a force refresh reuses a just-fetched token', async () => {
    const { manager, fetchToken, triggerWake } = createHarness();
    manager.prime(makeJwt(Date.now() + 3_600_000));
    manager.start();

    vi.setSystemTime(Date.now() + 2 * 3_600_000);
    const fresh = makeJwt(Date.now() + 3_600_000, 'fresh');
    fetchToken.mockResolvedValue(fresh);
    triggerWake();
    await vi.advanceTimersByTimeAsync(1_000);

    // Convex reconnects right after the proactive refresh finished.
    await expect(
      manager.fetchAccessToken({ forceRefreshToken: true }),
    ).resolves.toBe(fresh);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it('interval: refreshes an aging token in the background', async () => {
    const { manager, fetchToken } = createHarness();
    manager.prime(makeJwt(Date.now() + 3_600_000));
    const stop = manager.start();
    fetchToken.mockResolvedValue(makeJwt(Date.now() + 7_200_000, 'rotated'));

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchToken).toHaveBeenCalledTimes(1);

    stop();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it('single-flight: concurrent consumers share one refresh', async () => {
    const { manager, fetchToken } = createHarness();
    const fresh = makeJwt(Date.now() + 3_600_000);
    fetchToken.mockResolvedValue(fresh);

    const [a, b] = await Promise.all([
      manager.fetchAccessToken({}),
      manager.getToken(),
    ]);
    expect(a).toBe(fresh);
    expect(b).toBe(fresh);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it('clear: an in-flight refresh cannot resurrect a cleared token', async () => {
    const { manager, fetchToken } = createHarness();
    let resolveFetch: (token: string) => void = () => {};
    fetchToken.mockImplementation(
      () => new Promise<string>(resolve => (resolveFetch = resolve)),
    );

    const pending = manager.getToken();
    manager.clear();
    resolveFetch(makeJwt(Date.now() + 3_600_000, 'late'));
    await pending;

    expect(manager.getSnapshot().token).toBeNull();
  });
});

describe('createBetterAuthTokenFetcher', () => {
  it('maps a token response to the token', async () => {
    const fetcher = createBetterAuthTokenFetcher({
      convex: { token: async () => ({ data: { token: 'jwt' } }) },
    });
    await expect(fetcher()).resolves.toBe('jwt');
  });

  it('maps 401/403 to null (definitively signed out)', async () => {
    const fetcher = createBetterAuthTokenFetcher({
      convex: { token: async () => ({ error: { status: 401 } }) },
    });
    await expect(fetcher()).resolves.toBeNull();
  });

  it('throws on other errors so the manager retries', async () => {
    const fetcher = createBetterAuthTokenFetcher({
      convex: { token: async () => ({ error: { status: 503 } }) },
    });
    await expect(fetcher()).rejects.toThrow('status 503');
  });
});
