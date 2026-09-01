import { dive } from './diveFixture';
import { logbookStats } from './logbookStats';

/**
 * §3's three Stats figures, computed once for both callers — the summary line under the Dives
 * title (M1l) and M3's Stats screen. What these tests are about is the three ways this figure
 * set can be wrong while looking perfectly plausible: a planned dive counted, a missing reading
 * treated as a zero, and a corrupt value poisoning the whole total.
 */

describe('logbookStats', () => {
  // **The rule most likely to ship missing** (§2.4: a planned dive is "excluded from stats and
  // dive numbering"). A test that seeds three ordinary logged dives passes whether or not the
  // exclusion exists, so every assertion here has a plan in the input.
  //
  // All three figures, not just the count: a plan set up on the boat carries a site and often a
  // cylinder, and nothing stops it carrying a depth — §1 never blocks a save — so a plan that
  // slipped into the population would drag the deepest figure as readily as the count.
  it('leaves planned dives out of all three figures', () => {
    const stats = logbookStats([
      dive({ status: 'logged', durationMin: 40, maxDepthM: 18 }),
      dive({ status: 'planned', durationMin: 60, maxDepthM: 45 }),
    ]);
    expect(stats).toEqual({ dives: 1, minutes: 40, deepestM: 18 });
  });

  // A logbook holding nothing but plans is not an empty one — it has been used — and it has no
  // logged dive to report. `0 dives` over an "Up next" section is the true reading, and it is
  // the case the screen actually renders (DivesScreen.test.tsx has the other half).
  it('reports a logbook of plans as holding no dives at all', () => {
    expect(logbookStats([dive({ status: 'planned', durationMin: 55, maxDepthM: 30 })])).toEqual({
      dives: 0,
      minutes: null,
      deepestM: null,
    });
  });

  // Exact-match on `'logged'`, the convention `assignDiveNumbers` and `splitPlanned` already
  // follow: a status this build has never heard of (an older client, M2 sync) is not
  // affirmatively logged, so it is not counted rather than being counted by default.
  it('counts only what is affirmatively logged', () => {
    const odd = { ...dive({ durationMin: 30 }), status: 'archived' } as unknown as ReturnType<typeof dive>;
    expect(logbookStats([odd]).dives).toBe(0);
  });

  it('adds up the durations and takes the deepest depth', () => {
    expect(
      logbookStats([
        dive({ durationMin: 44, maxDepthM: 12.2 }),
        dive({ durationMin: 51, maxDepthM: 41.2 }),
        dive({ durationMin: 37, maxDepthM: 31.4 }),
      ]),
    ).toEqual({ dives: 3, minutes: 132, deepestM: 41.2 });
  });

  // Order must not decide the answer: this is called during render, on a list whose order is
  // `compareDiveOrder`'s and not this module's, and a maximum written as "the last one that was
  // bigger" would already be right — a maximum written as "the last one" would not.
  it('gives the same answer whatever order the dives arrive in', () => {
    const dives = [
      dive({ durationMin: 44, maxDepthM: 41.2 }),
      dive({ durationMin: 51, maxDepthM: 12.2 }),
      dive({ durationMin: 37, maxDepthM: 31.4 }),
    ];
    expect(logbookStats([...dives].reverse())).toEqual(logbookStats(dives));
  });

  // **Nothing recorded is not zero.** All of a dive's fields except its date are nullable (§6)
  // and §1 never asks a diver to fill one in, so a logbook of real dives with no durations
  // written down is ordinary. `0 h` under it would be a claim that they were instantaneous;
  // null is what lets the caller omit the figure instead.
  it('reports no total at all when nothing recorded one', () => {
    expect(logbookStats([dive({ maxDepthM: 18 }), dive({ maxDepthM: 22 })])).toEqual({
      dives: 2,
      minutes: null,
      deepestM: 22,
    });
    expect(logbookStats([dive({ durationMin: 40 }), dive({ durationMin: 35 })])).toEqual({
      dives: 2,
      minutes: 75,
      deepestM: null,
    });
  });

  // ...and the other side of that distinction: a dive that genuinely records a zero contributes
  // it, and the total is a real `0` rather than "nothing recorded". The app shows what was
  // written down.
  it('treats a recorded zero as a reading, not as an absence', () => {
    expect(logbookStats([dive({ durationMin: 0 })]).minutes).toBe(0);
  });

  it('has nothing to say about an empty logbook', () => {
    expect(logbookStats([])).toEqual({ dives: 0, minutes: null, deepestM: null });
  });

  it('reports one dive as one dive', () => {
    expect(logbookStats([dive({ durationMin: 47, maxDepthM: 18.4 })])).toEqual({
      dives: 1,
      minutes: 47,
      deepestM: 18.4,
    });
  });

  // **One corrupt value must not delete the figure for every other dive.** NaN propagates
  // through `+`, so a single unreadable duration in a hundred would make the whole total NaN
  // and blank a line that is otherwise perfectly true. The dive is still counted — it happened
  // — and only the reading it could not supply is skipped, which is the same "degrade the field,
  // never the dive" stance `composeDives` takes about a corrupt `dives_before`.
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative', -30],
    ['a string', '40' as unknown as number],
  ])('ignores a %s duration without losing the rest of the total', (_label, bad) => {
    const stats = logbookStats([dive({ durationMin: 40 }), dive({ durationMin: bad })]);
    expect(stats.dives).toBe(2);
    expect(stats.minutes).toBe(40);
  });

  // Depth goes through `isDisplayableDepth` (format/display.ts) rather than a second
  // finite-and-not-negative check written here, so the deepest figure this reports is always a
  // depth the screen can actually draw. A negative is the case those two answers once differed
  // on, and the one a `Math.max` would have got wrong in the other direction as well.
  //
  // **Both orders, and a corrupt depth on its own.** A running maximum only ever compares
  // against what it already holds, so a bad value arriving SECOND is rejected by the
  // comparison whether or not the predicate is there — `NaN > 18.4` is false and so is
  // `-12 > 18.4`. Only the value arriving first, into an empty maximum, actually asks the
  // predicate anything. A one-order test here would have passed with the guard weakened to a
  // bare `typeof === 'number'`, which is the mutation that found this.
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative', -12],
  ])('ignores a %s depth rather than reporting it as the deepest', (_label, bad) => {
    for (const dives of [
      [dive({ maxDepthM: 18.4 }), dive({ maxDepthM: bad })],
      [dive({ maxDepthM: bad }), dive({ maxDepthM: 18.4 })],
    ]) {
      const stats = logbookStats(dives);
      expect(stats.dives).toBe(2);
      expect(stats.deepestM).toBe(18.4);
    }
    // ...and alone, it leaves the figure with nothing behind it rather than becoming it.
    expect(logbookStats([dive({ maxDepthM: bad })]).deepestM).toBeNull();
  });

  // Called during render, so it may not throw on the shapes a bad join or a partially-hydrated
  // row can produce — `assignDiveNumbers` records the same three, for the same reason.
  it('survives what a corrupt read can hand it', () => {
    expect(logbookStats(null as unknown as [])).toEqual({ dives: 0, minutes: null, deepestM: null });
    const holed = [dive({ durationMin: 20 }), null, undefined] as unknown as ReturnType<typeof dive>[];
    expect(logbookStats(holed)).toEqual({ dives: 1, minutes: 20, deepestM: null });
  });
});
