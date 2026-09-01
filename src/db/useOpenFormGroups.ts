import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from './client';
import { isResolved } from './liveQuery';
import { openFormGroupsQuery, readOpenFormGroups } from './settings';

export interface OpenFormGroupsState {
  /**
   * What the diver has decided about each of §2.2's groups: `true` for one they left open,
   * `false` for one they collapsed, and **no entry for one they have never touched** — the
   * three states `readOpenFormGroups` (db/settings.ts) exists to keep apart, since the third is
   * what the form's own "open by default" answers.
   *
   * **Meaningless until `resolved`** — it reads `{}` there, which is what an absent row reads as
   * too, and the two mean different things.
   */
  remembered: Record<string, boolean>;
  /**
   * Whether the read has produced an answer yet — rows, or a failure (`isResolved`,
   * db/liveQuery.ts). The same field, the same name and the same meaning `useDives`,
   * `useGearPresets` and `useDivesBefore` carry; four hooks, one word for one fact (§4.1).
   *
   * **What a caller does with it here is deliberately NOT what the other three do**, and the
   * difference is worth stating because it looks like an inconsistency. Those three gate a
   * SENTENCE: "Dive not found." over a dive that is there, a blank form over a real dive, a
   * typed-over `0` that was never the diver's. A collapsed group says nothing false about the
   * dive — the fields are there, unexpanded, which is a state the diver can reach by hand — so
   * the dive form does not withhold its groups while this is `false`. It opens them on the half
   * it can answer without any read at all (does this dive have a value in that group), and lets
   * the remembered half land.
   *
   * That leaves this field with exactly one job on this screen, and it is a real one: it is how
   * the form tells "the diver has decided about every group" from "nobody has looked yet", so
   * the diver's own toggles can be layered onto a memory that is actually theirs. See
   * `DiveFormScreen`'s `toggleGroup` for the layering.
   */
  resolved: boolean;
}

/**
 * What the diver has decided about each of §2.2's collapsible groups, live.
 *
 * **Its own hook rather than another field on an existing read**, for the reason
 * `useUnitSystem` records at length and `useDivesBefore` repeats: `useDives` had to be taught
 * once already not to let a failed settings read blank a logbook, and separate hooks are the
 * strongest form of that separation rather than merely a stated one. This one is the weakest
 * claim of the four — a display preference on a form — which makes it the one that must be
 * least able to hurt anything else.
 *
 * It returns no `error`, like `useUnitSystem` and unlike `useDives`, because there is nothing a
 * caller could do differently: `readOpenFormGroups` (db/settings.ts) degrades an unreadable row
 * to §2.2's own defaults, and a banner over a dive being logged, about which groups are open,
 * would be the failure `useGearPresets`' docblock describes.
 *
 * Its whole pipeline is `readOpenFormGroups(openFormGroupsQuery(db))`, which `db/settings.test.ts`
 * exercises against a real database — the same split every other hook here documents, where the
 * pure half is tested directly and `useLiveQuery` itself is left to the app.
 */
export function useOpenFormGroups(): OpenFormGroupsState {
  const rows = useLiveQuery(openFormGroupsQuery(db));
  return { remembered: readOpenFormGroups(rows.data), resolved: isResolved(rows) };
}
