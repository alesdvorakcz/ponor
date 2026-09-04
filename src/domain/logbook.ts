/**
 * **What the app says about the logbook as a whole**, as opposed to about any one dive.
 *
 * One sentence today, and it is here because four screens said it (M3b, reported by M3a).
 * `db/useDives.ts`'s `error` is the event — the dives list, full-screen search, the Map tab
 * and the Stats tab each dispatch on it — and each carried its own literal copy until now.
 * §4.1 opens with what that costs ("a site name that said 'Unnamed site' in the list and
 * nothing at all on the detail"), and **the drift had already started**: three copies spelled
 * the apostrophe `'` and the fourth `’`, so the four were not one sentence any more by the time
 * anybody noticed they were four.
 *
 * **A module rather than a constant on `db/useDives.ts`, and the reason is concrete rather than
 * aesthetic.** `domain/presets.ts` is the precedent for the shape — `PRESETS_UNREADABLE` lives
 * in the module that owns what a preset is, not in `db/useGearPresets.ts` — and here there is a
 * second argument on top of it: every screen test in this repository mocks `../db/useDives`
 * wholesale, so a string exported from there is reachable only through `jest.requireActual`,
 * which would pull `expo-sqlite` and drizzle's live-query machinery into four test files that
 * exist precisely to avoid them. A sentence a screen renders must not carry a database with it.
 *
 * **The straight apostrophe is the majority spelling of the four and is what survived** —
 * deliberate rather than accidental, and `PRESETS_UNREADABLE` spells it the same way. The app
 * is inconsistent about this more widely (`SETTINGS_UNREACHABLE` and `cloud/auth.ts` use `’`);
 * that is one sweep, not four, and it belongs with i18next.
 *
 * This file imports nothing, on purpose.
 */

/**
 * Shown when the dives read itself failed — the one failure that blanks a whole screen, because
 * there is nothing honest to show in its place (`DiveListState.error`, db/useDives.ts).
 *
 * It names what to do rather than what happened: a diver cannot act on "the query rejected",
 * and reopening the app is the one thing that has ever fixed it.
 */
export const LOGBOOK_UNREADABLE = "Couldn't open your logbook. Try closing and reopening the app.";
