/**
 * Mirrors Better Auth's magic link `defaultKeyHasher`: SHA-256 of the raw
 * token, base64url encoded without padding.
 *
 * With `storeToken: 'hashed'` (which this kit enforces), the plugin stores
 * the pending verification row under this identifier. Anything that needs to
 * find that row from a raw token — the `/magic-link/verify` eligibility
 * re-check, dev-auth session seeding, `convex-e2e` `createSession`
 * implementations — must stay byte-compatible with the plugin, hence the
 * parity test against Better Auth itself in `hashToken.test.ts`.
 *
 * Uses WebCrypto so it runs in the Convex runtime, Node >= 18, and browsers.
 */
export async function hashVerificationToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  let binary = '';
  for (const byte of new Uint8Array(digest)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
