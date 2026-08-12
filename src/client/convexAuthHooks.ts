// React glue for the Convex token manager. Kept out of the root entry —
// only `/client` may import React.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type {
  ConvexTokenManager,
  ConvexTokenSnapshot,
  FetchAccessTokenArgs,
} from './convexTokenManager.js';

export type ConvexAuthHookResult = {
  isLoading: boolean;
  isAuthenticated: boolean;
  fetchAccessToken: (args: FetchAccessTokenArgs) => Promise<string | null>;
};

export type ConvexAuthHooks = {
  /**
   * Hook for `ConvexProviderWithAuth`'s `useAuth` prop. Reports
   * `isAuthenticated` as long as a (possibly stale) token exists — the
   * manager only drops to unauthenticated once the token expired and
   * retries are exhausted. The `fetchAccessToken` identity is keyed on the
   * manager's auth epoch, so a successful refresh after an auth loss makes
   * `ConvexProviderWithAuth` call `client.setAuth` again — the automatic
   * replacement for the "reload always fixes it" workaround.
   */
  useAuth: () => ConvexAuthHookResult;
  /**
   * Current token as reactive state (`undefined` = not yet resolved,
   * `null` = signed out). Drop-in replacement for Convex Auth's
   * `useAuthToken`.
   */
  useAuthToken: () => string | null | undefined;
  /** Full manager snapshot, e.g. to inspect `isRefreshing`. */
  useTokenSnapshot: () => ConvexTokenSnapshot;
};

/**
 * Builds the React hooks for a (module-scoped) token manager instance.
 * Every hook starts the manager's wake listeners + refresh interval while
 * mounted (ref-counted, so multiple consumers are fine).
 *
 * @example
 * ```tsx
 * const tokenManager = createConvexTokenManager({
 *   fetchToken: createBetterAuthTokenFetcher(authClient),
 * });
 * const { useAuth } = createConvexAuthHooks(tokenManager);
 *
 * <ConvexProviderWithAuth client={convex} useAuth={useAuth}>
 * ```
 */
export function createConvexAuthHooks(
  manager: ConvexTokenManager,
): ConvexAuthHooks {
  function useTokenSnapshot(): ConvexTokenSnapshot {
    useEffect(() => manager.start(), []);
    return useSyncExternalStore(
      manager.subscribe,
      manager.getSnapshot,
      manager.getSnapshot,
    );
  }

  function useAuth(): ConvexAuthHookResult {
    const snapshot = useTokenSnapshot();
    const fetchAccessToken = useMemo(
      () => (args: FetchAccessTokenArgs) => manager.fetchAccessToken(args),
      // A new identity per auth epoch re-triggers `client.setAuth`.
      [snapshot.authEpoch],
    );
    return {
      isLoading: snapshot.token === undefined,
      isAuthenticated: typeof snapshot.token === 'string',
      fetchAccessToken,
    };
  }

  function useAuthToken(): string | null | undefined {
    return useTokenSnapshot().token;
  }

  return { useAuth, useAuthToken, useTokenSnapshot };
}

/**
 * Debounces a pending/auth-loss flag so short-lived intermediate states
 * (wake-up races, quick token refreshes) never flash UI like "renewing
 * sign-in…". Returns `true` only once `pending` has been `true` for
 * `delayMs` continuously; resets immediately when `pending` drops.
 */
export function useDelayedAuthPending(
  pending: boolean,
  delayMs = 3_000,
): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!pending) {
      setElapsed(false);
      return;
    }
    const timer = setTimeout(() => {
      setElapsed(true);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [pending, delayMs]);
  return pending && elapsed;
}
