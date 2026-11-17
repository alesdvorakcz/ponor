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
 *  · **Email** — one plain address. A `?`, `&`, `,`, `;` or `:` would let the text add a subject,
 *    a `bcc` or a second recipient to the message the diver thinks they are writing, so none is
 *    allowed.
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

const EMAIL = /^[^\s@?&,;:<>/]+@[^\s@?&,;:<>/]+\.[^\s@?&,;:<>/]+$/;

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
