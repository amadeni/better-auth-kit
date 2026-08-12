/**
 * Standardized auth error codes shared across the fleet.
 *
 * The values are the exact strings thrown by the Convex-side hooks and
 * triggers (as `APIError('BAD_REQUEST', { message: <code> })` or plain
 * `Error(<code>)`), and matched again on the client by `parseSignInError`.
 * They are wire-compatible with the existing apps, so a consumer can migrate
 * without invalidating stored behavior or UI error mapping.
 */
export const AUTH_ERROR_CODES = {
  /** No email address was provided with the sign-in request. */
  EMAIL_MISSING: 'Email is required',
  /**
   * The address is not eligible to sign in (unknown, deleted, or
   * registration is closed). Prefer `SIGN_IN_LINK_UNAVAILABLE` for new
   * consumers — it does not confirm whether an account exists.
   */
  USER_NOT_FOUND: 'User not found',
  /** Non-enumerating denial: the sign-in link cannot be sent. */
  SIGN_IN_LINK_UNAVAILABLE: 'Unable to send sign-in link',
  /** The users table is empty and INITIAL_ADMIN_EMAIL is not configured. */
  INITIAL_ADMIN_EMAIL_REQUIRED:
    'INITIAL_ADMIN_EMAIL is required to bootstrap the initial admin',
} as const;

export type AuthErrorCode = keyof typeof AUTH_ERROR_CODES;

export type AuthErrorCodeValue = (typeof AUTH_ERROR_CODES)[AuthErrorCode];
