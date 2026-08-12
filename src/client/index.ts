// Browser/React entry point.

import { convexClient } from '@convex-dev/better-auth/client/plugins';
import { magicLinkClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

type ClientOptions = Parameters<typeof createAuthClient>[0] & object;
type ClientPlugins = NonNullable<ClientOptions['plugins']>;

export type AmadeniAuthClientConfig<
  TExtra extends ClientPlugins = ClientPlugins,
> = {
  /** Usually omitted — the client talks to the same-origin `/api/auth`. */
  baseURL?: string;
  /** Additional client plugins (e.g. an OAuth provider client). */
  extraPlugins?: TExtra;
};

/**
 * `createAuthClient` pre-wired with the convex and magic link client
 * plugins — the client-side counterpart of `createAmadeniAuthOptions`.
 */
export type AmadeniAuthClient<TExtra extends ClientPlugins = never[]> =
  ReturnType<
    typeof createAuthClient<{
      plugins: (
        | ReturnType<typeof convexClient>
        | ReturnType<typeof magicLinkClient>
        | TExtra[number]
      )[];
    }>
  >;

export function createAmadeniAuthClient<TExtra extends ClientPlugins = never[]>(
  config: AmadeniAuthClientConfig<TExtra> = {},
): AmadeniAuthClient<TExtra> {
  return createAuthClient({
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    plugins: [
      convexClient(),
      magicLinkClient(),
      ...((config.extraPlugins ?? []) as TExtra),
    ],
  });
}

export {
  AUTH_ERROR_CODES,
  type AuthErrorCode,
  type AuthErrorCodeValue,
} from '../errorCodes.js';
export {
  getSignInErrorMessage,
  getVerifyErrorMessage,
  parseSignInError,
  SIGN_IN_ERROR_MESSAGES_DE,
  SIGN_IN_FALLBACK_MESSAGE_DE,
  VERIFY_FALLBACK_MESSAGE_DE,
  VERIFY_TOKEN_INVALID_MESSAGE_DE,
} from './signInErrors.js';
