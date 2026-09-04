import { resolveMergeTargets, type MergeRow } from './merges';

/**
 * **Where a merged catalogue row sends a dive** (DESIGN.md §5) — the rule alone, with no
 * database and no sync anywhere near it.
 *
 * Three of the cases below are the ones that decide whether this feature is safe, and none of
 * them fails loudly if it is wrong:
 *
 * · **A chain.** A merged into B, later B merged into C. One merge proves nothing about two —
 *   an implementation that reads one hop and stops passes every single-merge test there is and
 *   leaves the dive at B, which is a row nothing shows.
 * · **A cycle.** The rows come from a server this repository does not control, so A→B→A can
 *   arrive. An undefended walk **hangs**, and a suite that hangs reads as a slow suite rather
 *   than a broken one (M2l hit exactly that). Both guards are exercised here, and the `bound`
 *   inside `resolveMergeTargets` exists so that deleting the `seen` check turns these tests red
 *   instead of turning them into a spin.
 * · **`hidden`.** The third `CatalogueStatus`, and the only one with no story of its own. A
 *   hidden row carrying a `merged_into` must move nobody, or a status that means "withdrawn"
 *   would quietly acquire the power of one that means "is somewhere else".
 */

const row = (over: Partial<MergeRow> & Pick<MergeRow, 'id'>): MergeRow => ({
  status: 'merged',
  mergedInto: null,
  ...over,
});

/** The answer as a plain object, so a failure prints the whole mapping rather than `Map {}`. */
const targets = (rows: readonly MergeRow[]) => Object.fromEntries(resolveMergeTargets(rows));

describe('one merge', () => {
  it('sends a merged row at the survivor it names', () => {
    expect(targets([row({ id: 'a', mergedInto: 'b' })])).toEqual({ a: 'b' });
  });

  it('says nothing about a row nobody merged', () => {
    expect(targets([row({ id: 'a', status: 'active', mergedInto: null })])).toEqual({});
  });

  it('says nothing about a merged row with nowhere to point', () => {
    // §6's own "a status that can read merged with nowhere to point is a state with no repair"
    // (M2a). There is no survivor to name, so the dive keeps the pointer it has.
    expect(targets([row({ id: 'a', mergedInto: null })])).toEqual({});
  });

  it('reads a blank survivor as no survivor', () => {
    expect(targets([row({ id: 'a', mergedInto: '' })])).toEqual({});
  });

  it('ignores a row with no id of its own', () => {
    expect(targets([row({ id: '', mergedInto: 'b' })])).toEqual({});
  });
});

describe('the third status', () => {
  it('does not follow a hidden row, even one carrying a merged_into', () => {
    // The status is the statement (domain/types.ts). This pair is data the app gives no
    // meaning to, and the safe reading of it is that a withdrawn row moves nobody's dive.
    expect(targets([row({ id: 'a', status: 'hidden', mergedInto: 'b' })])).toEqual({});
  });

  it('breaks a chain that runs into a hidden row rather than jumping over it', () => {
    expect(
      targets([
        row({ id: 'a', mergedInto: 'b' }),
        row({ id: 'b', status: 'hidden', mergedInto: 'c' }),
      ]),
    ).toEqual({ a: 'b' });
  });

  it('does not follow an active row carrying a stale merged_into', () => {
    expect(targets([row({ id: 'a', status: 'active', mergedInto: 'b' })])).toEqual({});
  });
});

describe('a chain', () => {
  it('follows two hops to the end', () => {
    // The case a single-merge test cannot see: leaving `a` at `b` would look right in every
    // other test in this file and would still point at a row nothing shows.
    expect(
      targets([row({ id: 'a', mergedInto: 'b' }), row({ id: 'b', mergedInto: 'c' })]),
    ).toEqual({ a: 'c', b: 'c' });
  });

  it('follows four hops, in whatever order the rows arrive', () => {
    expect(
      targets([
        row({ id: 'c', mergedInto: 'd' }),
        row({ id: 'a', mergedInto: 'b' }),
        row({ id: 'd', mergedInto: 'e' }),
        row({ id: 'b', mergedInto: 'c' }),
      ]),
    ).toEqual({ a: 'e', b: 'e', c: 'e', d: 'e' });
  });

  it('lands on the survivor even when the survivor is itself a merged row with nowhere to go', () => {
    // `b` is merged and names nobody, so the chain ends there. The dives at `a` join the dives
    // at `b`, which is the point of the rewrite even though neither row is offerable.
    expect(
      targets([row({ id: 'a', mergedInto: 'b' }), row({ id: 'b', mergedInto: null })]),
    ).toEqual({ a: 'b' });
  });

  it('lands on a survivor this device has never heard of', () => {
    // §5 scopes the catalogue by country once the community is not young, so the survivor may
    // simply not be here. It is still the truthful pointer, and no worse than the merged row.
    expect(targets([row({ id: 'a', mergedInto: 'elsewhere' })])).toEqual({ a: 'elsewhere' });
  });
});

describe('a cycle, which is the case that hangs rather than failing', () => {
  it('answers nothing for a row merged into itself', () => {
    expect(targets([row({ id: 'a', mergedInto: 'a' })])).toEqual({});
  });

  it('answers nothing for a two-row cycle', () => {
    expect(
      targets([row({ id: 'a', mergedInto: 'b' }), row({ id: 'b', mergedInto: 'a' })]),
    ).toEqual({});
  });

  it('answers nothing for a longer cycle', () => {
    expect(
      targets([
        row({ id: 'a', mergedInto: 'b' }),
        row({ id: 'b', mergedInto: 'c' }),
        row({ id: 'c', mergedInto: 'a' }),
      ]),
    ).toEqual({});
  });

  it('answers nothing for a chain that runs into a cycle it is not part of', () => {
    // `a` is not in the cycle; its chain has no end all the same, so there is nowhere to send
    // its dives. The rows that ARE in the cycle answer nothing either.
    expect(
      targets([
        row({ id: 'a', mergedInto: 'b' }),
        row({ id: 'b', mergedInto: 'c' }),
        row({ id: 'c', mergedInto: 'b' }),
      ]),
    ).toEqual({});
  });

  it('leaves the rows around a cycle answering correctly', () => {
    expect(
      targets([
        row({ id: 'a', mergedInto: 'b' }),
        row({ id: 'b', mergedInto: 'a' }),
        row({ id: 'x', mergedInto: 'y' }),
      ]),
    ).toEqual({ x: 'y' });
  });
});

describe('what the answer may never contain', () => {
  it('never maps a row to itself, on any shape of input', () => {
    // `db/dives.ts` treats every hit as a real change and writes without comparing, so a
    // self-mapping here would be a dive rewritten to the value it already held — advancing
    // `updated_at` for nothing (§6) and finding the same work again on every cycle.
    const rows = [
      row({ id: 'a', mergedInto: 'a' }),
      row({ id: 'b', mergedInto: 'c' }),
      row({ id: 'c', mergedInto: 'b' }),
      row({ id: 'd', mergedInto: 'e' }),
      row({ id: 'e', mergedInto: 'f' }),
    ];
    for (const [from, to] of resolveMergeTargets(rows)) expect(to).not.toBe(from);
  });

  it('answers an empty map for an empty catalogue', () => {
    expect(targets([])).toEqual({});
  });

  it('survives a row that is not there at all', () => {
    // `to_jsonb(row)` and a hand-edited fixture are both real sources of a hole in a list.
    const rows = [null, row({ id: 'a', mergedInto: 'b' }), undefined] as unknown as MergeRow[];
    expect(targets(rows)).toEqual({ a: 'b' });
  });
});
