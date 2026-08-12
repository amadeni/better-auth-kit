/**
 * THE canonical email normalization for auth across the fleet.
 *
 * Rules:
 * - `null` / `undefined` / empty input canonicalize to `''`
 * - surrounding whitespace is trimmed
 * - the whole address is lowercased
 * - plus sub-addresses are kept: `nico+crm@example.com` is a distinct
 *   identity from `nico@example.com`. Apps that want to collapse
 *   sub-addresses (e.g. the Hub) layer their own `stripSubAddress` on top
 *   and pass the composed function wherever the kit accepts `canonicalize`.
 *
 * No validation happens here — validation is a separate concern; this
 * function only defines equality of addresses.
 */
export function canonicalizeAuthEmail(email: string | null | undefined) {
  if (!email) return '';
  return email.trim().toLowerCase();
}
