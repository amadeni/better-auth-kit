import { describe, expect, it } from 'vitest';
import { AUTH_ERROR_CODES } from '../errorCodes.js';
import {
  getSignInErrorMessage,
  getVerifyErrorMessage,
  parseSignInError,
  SIGN_IN_FALLBACK_MESSAGE_DE,
  VERIFY_FALLBACK_MESSAGE_DE,
  VERIFY_TOKEN_INVALID_MESSAGE_DE,
} from './signInErrors.js';

describe('parseSignInError', () => {
  it('extracts each standardized code from an Error message', () => {
    for (const [code, text] of Object.entries(AUTH_ERROR_CODES)) {
      expect(parseSignInError(new Error(text))).toBe(code);
    }
  });

  it('matches codes embedded in longer messages', () => {
    expect(
      parseSignInError(new Error('BAD_REQUEST: Unable to send sign-in link')),
    ).toBe('SIGN_IN_LINK_UNAVAILABLE');
  });

  it('reads Better Auth client error envelopes', () => {
    expect(
      parseSignInError({ error: { message: 'User not found', status: 400 } }),
    ).toBe('USER_NOT_FOUND');
    expect(parseSignInError({ message: 'Email is required' })).toBe(
      'EMAIL_MISSING',
    );
  });

  it('reads raw strings', () => {
    expect(
      parseSignInError(
        'INITIAL_ADMIN_EMAIL is required to bootstrap the initial admin',
      ),
    ).toBe('INITIAL_ADMIN_EMAIL_REQUIRED');
  });

  it('returns null for unknown errors', () => {
    expect(parseSignInError(new Error('boom'))).toBeNull();
    expect(parseSignInError(undefined)).toBeNull();
    expect(parseSignInError(null)).toBeNull();
    expect(parseSignInError({})).toBeNull();
    expect(parseSignInError(42)).toBeNull();
  });
});

describe('getSignInErrorMessage', () => {
  it('maps every code to a German message', () => {
    expect(getSignInErrorMessage('EMAIL_MISSING')).toBe(
      'E-Mail-Adresse ist erforderlich',
    );
    expect(getSignInErrorMessage('USER_NOT_FOUND')).toBe(
      'Diese E-Mail ist nicht freigeschaltet',
    );
    expect(getSignInErrorMessage('SIGN_IN_LINK_UNAVAILABLE')).toBe(
      'Login-Link konnte nicht gesendet werden',
    );
    expect(getSignInErrorMessage('INITIAL_ADMIN_EMAIL_REQUIRED')).toBe(
      'Der erste Admin-Login ist noch nicht konfiguriert',
    );
  });

  it('falls back for unknown errors', () => {
    expect(getSignInErrorMessage(null)).toBe(SIGN_IN_FALLBACK_MESSAGE_DE);
  });

  it('composes with parseSignInError end to end', () => {
    expect(
      getSignInErrorMessage(parseSignInError(new Error('User not found'))),
    ).toBe('Diese E-Mail ist nicht freigeschaltet');
    expect(getSignInErrorMessage(parseSignInError(new Error('boom')))).toBe(
      SIGN_IN_FALLBACK_MESSAGE_DE,
    );
  });
});

describe('getVerifyErrorMessage', () => {
  it('maps invalid and expired tokens to one message', () => {
    expect(getVerifyErrorMessage('INVALID_TOKEN')).toBe(
      VERIFY_TOKEN_INVALID_MESSAGE_DE,
    );
    expect(getVerifyErrorMessage('EXPIRED_TOKEN')).toBe(
      VERIFY_TOKEN_INVALID_MESSAGE_DE,
    );
  });

  it('falls back for anything else', () => {
    expect(getVerifyErrorMessage('SOMETHING_ELSE')).toBe(
      VERIFY_FALLBACK_MESSAGE_DE,
    );
  });
});
