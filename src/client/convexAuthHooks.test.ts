// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConvexAuthHooks,
  useDelayedAuthPending,
} from './convexAuthHooks.js';
import { createConvexTokenManager } from './convexTokenManager.js';

function makeJwt(expMs: number, marker = 'a'): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(expMs / 1000), marker }),
  ).toString('base64url');
  return `header.${payload}.signature`;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDelayedAuthPending', () => {
  it('surfaces pending only after the delay and resets immediately', async () => {
    const { result, rerender } = renderHook(
      ({ pending }: { pending: boolean }) => useDelayedAuthPending(pending),
      { initialProps: { pending: false } },
    );
    expect(result.current).toBe(false);

    rerender({ pending: true });
    expect(result.current).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(2_999));
    expect(result.current).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.current).toBe(true);

    // Recovery hides the pending UI without any delay.
    rerender({ pending: false });
    expect(result.current).toBe(false);

    // A short blip never becomes visible.
    rerender({ pending: true });
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    rerender({ pending: false });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(result.current).toBe(false);
  });
});

describe('createConvexAuthHooks', () => {
  it('useAuth: loads the initial token and keeps fetchAccessToken stable across renders', async () => {
    const fresh = makeJwt(Date.now() + 3_600_000);
    const manager = createConvexTokenManager({
      fetchToken: async () => fresh,
      attachWakeListeners: () => () => {},
    });
    const { useAuth } = createConvexAuthHooks(manager);

    const { result, rerender } = renderHook(() => useAuth());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isAuthenticated).toBe(true);
    await expect(
      result.current.fetchAccessToken({ forceRefreshToken: false }),
    ).resolves.toBe(fresh);

    const fetcherBefore = result.current.fetchAccessToken;
    rerender();
    expect(result.current.fetchAccessToken).toBe(fetcherBefore);
  });

  it('useAuth: rotates the fetchAccessToken identity on recovery so setAuth re-runs', async () => {
    let online = false;
    let wake: () => void = () => {};
    const fresh = makeJwt(Date.now() + 3_600_000, 'recovered');
    const manager = createConvexTokenManager({
      fetchToken: async () => {
        if (!online) {
          throw new Error('offline');
        }
        return fresh;
      },
      retryDelaysMs: [],
      attachWakeListeners: onWake => {
        wake = onWake;
        return () => {};
      },
    });
    const { useAuth } = createConvexAuthHooks(manager);

    const { result } = renderHook(() => useAuth());
    // Initial load fails outright → unauthenticated (nothing cached).
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.isAuthenticated).toBe(false);
    await act(async () => {
      await expect(
        result.current.fetchAccessToken({ forceRefreshToken: true }),
      ).resolves.toBeNull();
    });
    const fetcherWhileLoggedOut = result.current.fetchAccessToken;

    // The network returns; the online event recovers the session.
    online = true;
    await act(async () => {
      wake();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.fetchAccessToken).not.toBe(fetcherWhileLoggedOut);
  });
});
