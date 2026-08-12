import { AUTH_ERROR_CODES, type AuthErrorCode } from '../errorCodes.js';

/** German user-facing messages for the standardized sign-in error codes. */
export const SIGN_IN_ERROR_MESSAGES_DE: Record<AuthErrorCode, string> = {
  EMAIL_MISSING: 'E-Mail-Adresse ist erforderlich',
  USER_NOT_FOUND: 'Diese E-Mail ist nicht freigeschaltet',
  SIGN_IN_LINK_UNAVAILABLE: 'Login-Link konnte nicht gesendet werden',
  INITIAL_ADMIN_EMAIL_REQUIRED:
    'Der erste Admin-Login ist noch nicht konfiguriert',
};

export const SIGN_IN_FALLBACK_MESSAGE_DE =
  'Die Anmeldung konnte nicht gestartet werden';

export const VERIFY_TOKEN_INVALID_MESSAGE_DE =
  'Der Login-Link ist ungültig oder abgelaufen';

export const VERIFY_FALLBACK_MESSAGE_DE =
  'Die Anmeldung konnte nicht abgeschlossen werden';

function extractMessage(error: unknown): string | null {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    // Better Auth client responses nest the payload under `error`.
    const nested = (error as { error?: unknown }).error;
    if (nested && nested !== error) return extractMessage(nested);
  }
  return null;
}

// Longest first so more specific codes win if messages ever nest.
const CODES_BY_SPECIFICITY = (
  Object.entries(AUTH_ERROR_CODES) as [AuthErrorCode, string][]
).sort((a, b) => b[1].length - a[1].length);

/**
 * Extracts a standardized `AuthErrorCode` from whatever the magic link
 * sign-in surface hands back: an `Error` whose message contains the code
 * (the Convex before-hook throws `APIError('BAD_REQUEST', { message:
 * <code> })`, which the client sees as the error message), a Better Auth
 * client `{ error: { message } }` envelope, or a raw string. Returns `null`
 * for anything unrecognized.
 */
export function parseSignInError(error: unknown): AuthErrorCode | null {
  const message = extractMessage(error);
  if (!message) return null;
  for (const [code, text] of CODES_BY_SPECIFICITY) {
    if (message.includes(text)) return code;
  }
  return null;
}

/**
 * German message for a parsed code (or directly for an unknown error via
 * `getSignInErrorMessage(parseSignInError(err))`).
 */
export function getSignInErrorMessage(code: AuthErrorCode | null): string {
  return code ? SIGN_IN_ERROR_MESSAGES_DE[code] : SIGN_IN_FALLBACK_MESSAGE_DE;
}

/**
 * German message for the `?error=…` query param Better Auth appends to the
 * `errorCallbackURL` when the verify step fails.
 */
export function getVerifyErrorMessage(errorParam: string): string {
  if (errorParam === 'INVALID_TOKEN' || errorParam === 'EXPIRED_TOKEN') {
    return VERIFY_TOKEN_INVALID_MESSAGE_DE;
  }
  return VERIFY_FALLBACK_MESSAGE_DE;
}
