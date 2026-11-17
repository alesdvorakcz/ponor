import * as Linking from 'expo-linking';

/**
 * **What a centre's phone number and email may make another diver's phone do** — the one owner,
 * one module over from `openWebsite.ts`, whose argument applies unchanged: both columns are
 * community text from another diver, nullable and unconstrained (§1, §6), and `openURL` is a
 * general door into the device.
 *
 * So a value is turned into a `tel:` or `mailto:` address only when it *is* a number or an
 * address, and **nothing handed to `openURL` is ever built from text that failed the test**: the
 * page shows such text as plain text with nothing to press (`ask at the bar`, `dive@`).
 *
 *  · **Phone** — digits, spaces and `-()./`, one `+` and only first, at least three digits. The
 *    URL carries the `+` and the digits and nothing else, so no separator, extension or
 *    `;`-parameter in the stored text can reach the dialler.
 *  · **Email** — one plain address, by **allowlist**: letters, digits and `._+-` before the `@`,
 *    dot-joined labels of letters, digits and `-` after it, and nothing else. A blocklist of
 *    `?&,;:` is not enough — other divers' text reaches the mail app, and a percent-encoded `,`
 *    or `?`, a `%0D%0A`, a `#` or a control character would add a recipient or a header in any
 *    handler that decodes before it splits.
 *
 * Nothing here throws, and nothing is logged (`cloud/auth.ts`' reason, §9's Sentry).
 */

/** The `tel:` address for a phone number the dialler can be trusted with, or `null`. */
export function telUrl(phone: string | null): string | null {
  if (phone === null) return null;
  const value = phone.trim();
  if (!/^\+?[\d\s\-()./]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 3) return null;
  return `tel:${value.startsWith('+') ? '+' : ''}${digits}`;
}

// An ALLOWLIST, not a list of what to keep out: the text is another diver's and reaches the mail
// app inside `mailto:`, where `%2C`, `%3F`, `%0D%0A`, `#`, quotes and control characters can add a
// recipient, a header or a query once a handler decodes them. Local part `[A-Za-z0-9._+-]`, then
// dot-joined labels of `[A-Za-z0-9-]` with at least one dot; nothing else passes.
const EMAIL = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/** The `mailto:` address for one plain email address, or `null`. */
export function mailtoUrl(email: string | null): string | null {
  if (email === null) return null;
  const value = email.trim();
  return EMAIL.test(value) ? `mailto:${value}` : null;
}

/** Opens an address `telUrl` or `mailtoUrl` made. A refusal — no dialler, no mail app — leaves the
 * diver on the page they were reading, as `openWebsite` does. */
export async function openContactUrl(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    // A dead press either way, and no sentence worth drawing (`openWebsite.ts`).
  }
}
