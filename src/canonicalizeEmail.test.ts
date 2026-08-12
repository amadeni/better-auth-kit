import { describe, expect, it } from 'vitest';
import { canonicalizeAuthEmail } from './canonicalizeEmail.js';

describe('canonicalizeAuthEmail', () => {
  it('lowercases the whole address', () => {
    expect(canonicalizeAuthEmail('Nico.Tester@Example.COM')).toBe(
      'nico.tester@example.com',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(canonicalizeAuthEmail('  user@example.com \n')).toBe(
      'user@example.com',
    );
  });

  it('keeps plus sub-addresses as distinct identities', () => {
    expect(canonicalizeAuthEmail('user+crm@example.com')).toBe(
      'user+crm@example.com',
    );
    expect(canonicalizeAuthEmail('user+crm@example.com')).not.toBe(
      canonicalizeAuthEmail('user@example.com'),
    );
  });

  it('maps null, undefined and empty input to the empty string', () => {
    expect(canonicalizeAuthEmail(null)).toBe('');
    expect(canonicalizeAuthEmail(undefined)).toBe('');
    expect(canonicalizeAuthEmail('')).toBe('');
  });

  it('does not invent structure for whitespace-only input', () => {
    expect(canonicalizeAuthEmail('   ')).toBe('');
  });

  it('is idempotent', () => {
    const once = canonicalizeAuthEmail(' User+Tag@Example.com ');
    expect(canonicalizeAuthEmail(once)).toBe(once);
  });

  it('treats differently-cased addresses as the same identity', () => {
    expect(canonicalizeAuthEmail('USER@EXAMPLE.COM')).toBe(
      canonicalizeAuthEmail('user@example.com'),
    );
  });

  it('does not strip dots or otherwise rewrite the local part', () => {
    expect(canonicalizeAuthEmail('first.last@example.com')).toBe(
      'first.last@example.com',
    );
  });
});
