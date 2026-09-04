import { MERGED_CATALOGUE_STATUS, type CatalogueStatus } from './types';

/**
 * **Where a merged catalogue row sends the dives that pointed at it** — the whole of what
 * DESIGN.md §5's *"an admin setting `status` to `merged` with `merged_into` pointing at the
 * survivor"* means to a device, in one pure function.
 *
 * ── What was broken, and it was silent ────────────────────────────────────────────────────
 *
 * `pull_changes` delivers a `merged` row on purpose — M2c's line, *"a pull delivers
 * tombstoned, merged and hidden rows because the device has to be TOLD about them; a search
 * offers something to pick"* — and until M2r nothing on the device acted on one.
 * `merged_into` appeared nowhere in `src/` outside comments explaining what it was. A dive
 * paired to the folded row kept pointing at a row every catalogue read filters out
 * (`pickable`, db/catalogue.ts): its `site_name` snapshot still read correctly, so nothing
 * looked wrong, while the pairing was dead — the dive was not grouped with the survivor's
 * dives on the Map (§3), and §2.1's site defaults had nothing to prefill from. It looked
 * exactly like data that had simply never been linked.
 *
 * ── Why the answer is a rewrite of the pointer, and not a rule applied at every read ───────
 *
 * §6 gives a dive two fields for one place and gives them different jobs: `site_name` is a
 * **snapshot**, kept so history reads as it was recorded, and `site_id` is a **pointer** into
 * a catalogue whose rows are the community's. A merge is a statement about identity — A and B
 * are the same place — so it is a statement about the pointer and about nothing else. Moving
 * the pointer and leaving the snapshot alone is that split taken at its word.
 *
 * The alternative was resolving on read, and §4.1 is what rules it out: every reader would have
 * to apply the rule, and the readers are already four (`placeKeyOf` on the Map, carry-over, the
 * form, and §2.1's defaults when they land). Forgetting it in the fifth costs nothing visible —
 * a dive quietly not grouped — which is the exact class of failure this milestone keeps
 * finding. It would also have to reach `domain/mapSites.ts`, which is pure and takes a `Dive`
 * alone: the personal layer would have to be handed the catalogue, and §3's Map bullet keeps
 * the two layers apart deliberately. After a rewrite there is nothing for anyone to remember.
 *
 * **This module decides where; it never writes.** `db/catalogue.ts` reads the rows,
 * `db/dives.ts` writes the dives, `cloud/sync.ts` sequences the two after a pull.
 *
 * ── A chain, and a cycle, and why the cycle is the dangerous one ───────────────────────────
 *
 * A merged into B, later B merged into C: a dive at A belongs at C, so a chain is followed to
 * its end. The data comes from a server this repository does not control, so the chain may
 * also be **circular** — A into B into A, or a row merged into itself — and the failure mode of
 * an undefended walk is not a wrong answer but a **hang**, which in a test suite looks like
 * slowness rather than a bug. Both guards below are therefore structural, and the second exists
 * so that removing the first fails loudly instead of spinning.
 */

/** The three columns a merge is made of, on either community table (§6). `status` is carried
 * rather than filtered in SQL so that the `hidden` decision lives here, where it is testable,
 * rather than in a `where` clause nobody reads. */
export interface MergeRow {
  readonly id: string;
  readonly status: CatalogueStatus;
  readonly mergedInto: string | null;
}

/**
 * Every merged row's **final** survivor, keyed by the row it replaces.
 *
 * A row is absent from the answer when following it leads nowhere a dive can be sent:
 *
 * · **It is not `merged`.** Only `MERGED_CATALOGUE_STATUS` is followed (domain/types.ts has
 *   the reason). `active` names no survivor; `hidden` is a bad entry withdrawn, not a claim to
 *   be some other place, and a `hidden` row arriving with a `merged_into` set is data this app
 *   gives no meaning to rather than an instruction to move a diver's dive.
 * · **It names no survivor**, or names itself.
 * · **Its chain is circular.** There is no end to reach, so the honest answer is *no survivor*
 *   and the dive keeps the pointer it has. Picking some member of the cycle would be inventing
 *   a fact out of contradictory data, and two devices holding differently-scoped catalogues
 *   (§5: "country-scoped once it isn't" young) could invent different ones and push a dive back
 *   and forth for ever.
 *
 * The survivor a chain ends at is returned **whatever state it is in** — active, hidden,
 * tombstoned, merged-with-nowhere-to-point (§6's own "state with no repair"), or not held by
 * this device at all under a country-scoped catalogue. The merge statement A→B is true
 * regardless of what has since happened to B, and the point of the rewrite is that the dives at
 * A and the dives at B become one place; a survivor this device has never seen is no worse than
 * the merged row the dive points at today, and its name snapshot reads the same either way.
 *
 * **No entry ever maps an id to itself**, which is what lets `db/dives.ts` treat every hit as a
 * real change and never write a row that would advance `updated_at` for nothing (§6).
 */
export function resolveMergeTargets(rows: readonly MergeRow[]): ReadonlyMap<string, string> {
  const edges = new Map<string, string>();
  for (const row of rows) {
    if (row === null || row === undefined) continue;
    if (row.status !== MERGED_CATALOGUE_STATUS) continue;
    if (typeof row.id !== 'string' || row.id === '') continue;
    if (typeof row.mergedInto !== 'string' || row.mergedInto === '') continue;
    edges.set(row.id, row.mergedInto);
  }

  // **The bound is the second guard, and it exists to make the first one falsifiable.** Every
  // step consumes an edge that `seen` has not consumed yet, so no walk can take more steps than
  // there are edges and this throw is unreachable — the same shape as `pickable`'s (db/
  // catalogue.ts), and for the same reason: what it buys is that it cannot become reachable
  // quietly. Delete the `seen` check below and a circular chain hits this and raises, which a
  // test can fail on; with neither guard it would spin for ever, and a suite that hangs reads
  // as a slow suite rather than a broken one (M2l).
  const bound = edges.size + 1;

  const targets = new Map<string, string>();
  for (const start of edges.keys()) {
    const seen = new Set<string>([start]);
    let current = start;
    let steps = 0;
    for (;;) {
      const next = edges.get(current);
      // The end of the chain: a row nothing merged onwards, which is the survivor.
      if (next === undefined) break;
      // Back somewhere the walk has already been — a cycle, including the one-step case of a
      // row merged into itself. Answer nothing by landing back on the start.
      if (seen.has(next)) {
        current = start;
        break;
      }
      seen.add(next);
      current = next;
      steps += 1;
      if (steps > bound) throw new Error('resolveMergeTargets: a merge chain did not end');
    }
    if (current !== start) targets.set(start, current);
  }

  return targets;
}
