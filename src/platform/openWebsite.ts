import * as Linking from 'expo-linking';

/**
 * **Whether the app will hand a stored string to the outside world, and how** — the one place
 * that decides both (DESIGN.md §4.1).
 *
 * §6 gives `dive_centers` a `website`, and the only screen that shows one is a centre's page. A
 * web address on a phone is worth nothing unless it opens, so the row is pressable — but the
 * value is **community text**: it arrives from another diver through `push_changes`, the column
 * is nullable and unconstrained like every other (§6: no CHECK, §1: never block a save), and a
 * device this build has never met can put anything in it.
 *
 * ── What may be opened, and why the test is this strict ───────────────────────────────────
 *
 * An absolute `http:` or `https:` URL, and nothing else. Two things follow from that and each
 * is the reason for the other half of the rule:
 *
 *  · **A bare `aquasplit.hr` is not opened, and the row shows it as plain text.** `openURL`
 *    with no scheme is not a web address to the platform — iOS treats an unrecognised scheme as
 *    something for another app to claim, so the press either fails silently or opens a stranger.
 *    Guessing `https://` on the diver's behalf would be this module inventing a fact about
 *    somebody else's shop; showing the text and refusing the press is the honest half, and it is
 *    what makes a value that *is* a URL mean something.
 *  · **Only those two schemes**, never "any scheme the parser accepts". `openURL` is a general
 *    door into the device: `tel:`, `mailto:`, and every app-registered scheme on the phone go
 *    through it. A catalogue row is text one diver typed and every other diver reads, so the
 *    set of things it can make another diver's phone do is bounded here rather than by whoever
 *    is typing.
 *
 * ── Nothing here throws ───────────────────────────────────────────────────────────────────
 *
 * `openURL` rejects when the platform has nothing to open the address with, and a dead press is
 * the outcome either way — so the rejection is swallowed and the diver is left on the page they
 * were on. There is no sentence worth putting under the row for it: §0.6 objects four separate
 * times to a message with no gesture beneath it, and "your browser would not open" is exactly
 * that. Nothing is logged, for `cloud/auth.ts`'s reason (§9's Sentry turns console output into
 * breadcrumbs).
 *
 * **A module rather than three lines in the screen**, on `confirmDestructive`'s precedent: it is
 * the seam a test mocks, so the screen's own suite can assert *which* string was handed over
 * without a browser, and the rule about what may be handed over has one owner the day a second
 * URL column exists.
 */

/** Whether `openWebsite` would actually open this value — the rule above, asked in advance, so
 * a row can be a plain `Text` rather than a control that does nothing. */
export function isOpenableWebsite(website: string | null): website is string {
  if (website === null) return false;
  const value = website.trim();
  if (value === '') return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // Not an absolute URL at all — `new URL` is the parser, and its refusal is the answer. No
    // base is supplied on purpose: a relative reference has no meaning on a dive centre's row.
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/** Opens the address in whatever the platform uses for the web. A value `isOpenableWebsite`
 * refuses is not handed over at all, so the check and the act cannot disagree. */
export async function openWebsite(website: string | null): Promise<void> {
  if (!isOpenableWebsite(website)) return;
  try {
    await Linking.openURL(website.trim());
  } catch {
    // See the module docblock: a dead press either way, and no sentence worth drawing.
  }
}
