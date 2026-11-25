# Site and centre picker speed (#36) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing in the site and centre picker stays instant with thousands of catalogue rows and a long logbook. The picker shows exactly the same groups, and each screen reads only the rows it draws.

**Architecture:**
- A pairing lookup in `domain/catalogueDives.ts`, built once per logbook, replaces the per-row filter over all dives. `pickerGroups` caches it, keyed by the dives array it is handed.
- `browseCatalogue` folds each name once per call.
- `PlacePickerScreen` splits into one wrapper per kind, so each kind reads only its own table, plus the paired site by id for the centre page.
- The form's Site and Centre rows read their one row by id.

**Tech Stack:** TypeScript, React Native, drizzle `useLiveQuery`, Jest (jest-expo), @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-11-25-picker-speed-design.md` (owner-approved 2026-11-25). Issue #36.

## Global Constraints

- `src/domain/placePicker.test.ts` is not edited, and it passes. New picker tests go in a new file.
- No change to the stored data shape, the sync, or what the picker shows: groups, order, *Selected*, provenance, *also called*.
- No timing assertions in CI. The guards are an equivalence test and a read-count test.
- CI's exact checks pass before every push: `npm run typecheck && npm run lint && npm test -- --ci`. The suite fails on any `console.error`.
- The branch is `issue-36-picker-speed`. The PR body says `Closes #36`. No attribution lines in commits or the PR. Rebase on `main` before the PR.
- Public repo: no artifact links, keys or real dive data in commits or the PR. The seed data is invented and stays outside the repo.
- §4.1's rule stands. `diveBelongsToCatalogueRow` stays the one definition of pairing, and the lookup is tested against it.

## Review Focus

1. **A dive saved while the picker is open.** The new dive must show under *Dived here*, so a lookup cached by array identity must never serve an older logbook. Test: Task 3.
2. **Two catalogue rows with the same folded name.** Both list an unpaired dive of that name, as today, but a dive paired by id lists only under its own row. Test: Task 2's equivalence data.
3. **Picking a different place on the form.** The caption must follow the new row, so the by-id read must re-subscribe when the id changes. Test: Task 5.
4. **A centre picker opened from a dive whose site is not in the catalogue** (or has no position). No *Near [site]* group, and nothing breaks. Test: Task 4.
5. **A guest's unsynced site on the form** still says *on this phone only* through the by-id read. Test: Task 5.

---

### Task 1: Baseline measurement on the simulator

No product code. This measures today's picker, so the PR can show before and after.

**Files (all outside the repo):**
- Create: `<scratchpad>/bench36/seed36.py`. It prints SQL for invented data:
  - 5,000 `dive_sites` rows, `status='active'`, with positions spread over central Europe;
  - 1,000 `dives`, `status='logged'`, over 120 of the sites;
  - 30 % of the dives with `site_id = NULL` and only `site_name`;
  - 500 `dive_centers`.

  Copy the insert shape (`q`, `insert`, the column names) from `.superpowers/kept/issue-6/readme_seed.py`.
- Temporary, never committed: one `console.log('[bench36] groups ' + ms.toFixed(1) + ' ms')` around the `pickerGroups` call in `PlacePickerScreen.tsx`, timed with `performance.now()`. It is reverted with `git checkout` before Task 2.

- [ ] **Step 1:** Attach the simulator panel and start Metro from this checkout with `preview_start`. Install nothing new: the existing dev client is enough, because the JavaScript comes from Metro. The first use of a simulator asks Aleš for access.
- [ ] **Step 2:** Find the app's data container (`xcrun simctl get_app_container <udid> <bundle id> data`). Back up `Documents/SQLite/ponor.db`, then apply the seed with `sqlite3`.
- [ ] **Step 3:** Relaunch the app and open *New dive* → *Site*. Type `k`, then `ko`, `kot`, `kote`. Read `[bench36]` lines from the Metro logs. Also note the time for the page to open with nothing typed. Do the same on the centre picker.
  Expected: hundreds of ms or more per update with nothing typed. Record the numbers in the ledger.
- [ ] **Step 4:** `git checkout src/screens/PlacePickerScreen.tsx`. `git status` must be clean apart from the plan. Leave the seeded database in place for Task 6.
- [ ] **Step 5:** Commit the plan:

```bash
git add docs/superpowers/plans/2026-11-25-picker-speed.md
git commit -m "#36: implementation plan"
```

If the simulator can't be reached, put the Jest numbers from the spec in the ledger as the baseline, write `Ruling:` with the reason, and say so in the PR.

### Task 2: The pairing lookup

**Files:**
- Modify: `src/domain/catalogueDives.ts` (append)
- Modify: `src/domain/siteDives.ts`, `src/domain/centerDives.ts` (one projection each)
- Test: `src/domain/catalogueDives.test.ts`, `src/domain/siteDives.test.ts`, `src/domain/centerDives.test.ts`

**Interfaces:**
- Produces:
  - `catalogueDiveLookup<T>(dives: readonly T[], pairingOf: (dive: T) => DiveCataloguePairing): CatalogueDiveLookup<T>`
  - `divesOfRow<T>(lookup: CatalogueDiveLookup<T>, row: CatalogueRowIdentity): T[]`
  - `siteDiveLookup<T extends DiveSitePair>(dives: readonly T[]): CatalogueDiveLookup<T>` (siteDives.ts)
  - `centerDiveLookup<T extends DiveCenterPair>(dives: readonly T[]): CatalogueDiveLookup<T>` (centerDives.ts)
  - `CatalogueDiveLookup<T>` is an exported interface. Its fields are the builder's choice: two maps of input positions, one by paired id and one by folded snapshot.

**The rule the lookup must reproduce.** Each tier is `diveBelongsToCatalogueRow`'s own.

When building, for each dive at position `i`:
- Skip a falsy dive, or one whose pairing has `status !== 'logged'`.
- A non-empty string `pairedId` puts `i` under that id.
- Otherwise, a non-empty folded `snapshot` puts `i` under that folded name.

When asked for a row:
- A row whose id is not a non-empty string gets `[]`.
- Otherwise it gets the positions under its id, merged with those under `foldForMatching(row.name)` when that is non-empty.
- Merged ascending, and mapped back to the dives, so it is the same references in input order.

- [ ] **Step 1: Write the failing equivalence test** in `catalogueDives.test.ts`:

```ts
it('answers what filtering every dive through the rule answers, for every row', () => {
  // dives: paired by id (to a row, and to an id no row has); unpaired with names that fold
  // equal (`Železná`, ` zelezna `, `ZELEZNA`), differ, or are blank/null; a plan; a null entry;
  // an entry with a non-string id and a numeric name.
  // rows: two rows both named `Železná` with different ids, a row with null name, a row with
  // id '' and one with a non-string id.
  for (const row of rows) {
    const expected = dives.filter((d) => diveBelongsToCatalogueRow(d ? pairingOf(d) : null, row));
    expect(divesOfRow(catalogueDiveLookup(dives, pairingOf), row)).toEqual(expected);
    // same objects, same order
    divesOfRow(catalogueDiveLookup(dives, pairingOf), row).forEach((d, i) => expect(d).toBe(expected[i]));
  }
});
```

In `siteDives.test.ts` and `centerDives.test.ts`, add one test each: `siteDiveLookup` / `centerDiveLookup` gives `divesAtSite` / `divesWithCenter`'s answer for the same fixtures already in those files. This proves each one reads its own pair of columns, and that a site's lookup never reads `centerId`.

- [ ] **Step 2:** Run `npx jest src/domain/catalogueDives.test.ts src/domain/siteDives.test.ts src/domain/centerDives.test.ts`.
  Expected: FAIL, because the lookup functions are not exported.
- [ ] **Step 3:** Implement the five exports above. Add a docblock saying this is a second reading of the rule, checked against it by the equivalence test, and that `divesAtSite` / `divesWithCenter` stay for the pages.
- [ ] **Step 4:** Run the three files again. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `Pairing lookup: a row's dives from one pass over the logbook (#36)`.

### Task 3: `pickerGroups` pairs through the lookup; `browseCatalogue` folds once

**Files:**
- Modify: `src/domain/placePicker.ts` (`divesFor`, `pickerGroups`'s `logged` prefilter)
- Modify: `src/domain/search.ts` (`browseCatalogue`)
- Create: `src/domain/placePickerCost.test.ts`

**Interfaces:**
- Consumes: `siteDiveLookup`, `centerDiveLookup` and `divesOfRow` (Task 2).
- Produces: no new exports. `pickerGroups(input: PickerInput): PickerGroup[]` keeps its signature.

- [ ] **Step 1: Write the failing tests** in `placePickerCost.test.ts`. Dives are built with counting getters (`Object.defineProperty(dive, 'siteId', { get() { reads++; return … } })`). They point at ids no catalogue row has, so nothing but pairing reads them. Every test runs for both kinds: `siteId` for `'site'`, `centerId` for `'center'`.

```ts
it.each(['site', 'center'] as const)('reads each dive’s pairing once per logbook, not once per %s row', (kind) => {
  // 50 places, 20 unmatched dives
  pickerGroups({ ...base(kind), query: '' });
  expect(reads).toBeLessThanOrEqual(20);
});
it.each(['site', 'center'] as const)('reuses the pairing while the %s query changes', (kind) => {
  pickerGroups({ ...base(kind), dives, query: '' });
  const after = reads;
  pickerGroups({ ...base(kind), dives, query: 'ko' });
  pickerGroups({ ...base(kind), dives, query: 'kot' });
  expect(reads).toBe(after);
});
it.each(['site', 'center'] as const)('sees a dive logged while the %s picker is open', (kind) => {
  // Review Focus 1: a new array with one more dive paired to place 0 by id
  expect(pickerGroups({ ...base(kind), dives: [...dives, divedAtPlace0], query: '' })
    .find((g) => g.key === 'dived')?.rows.map((r) => r.id)).toEqual([places[0].id]);
});
```

- [ ] **Step 2:** Run `npx jest src/domain/placePickerCost.test.ts`. Expected: the first test fails, reading 50 × 20 times.
- [ ] **Step 3: Implement.**
  - `divesFor` becomes `divesOfRow(lookupFor(kind, input.dives), place)`.
  - `lookupFor` keeps one `WeakMap<readonly Dive[], CatalogueDiveLookup<Dive>>` per kind, keyed by the array `pickerGroups` was handed. A non-array input gets an empty lookup and is not cached.
  - The `logged` prefilter goes, since the lookup skips plans itself. Its comment goes with it.
  - In `search.ts`, `browseCatalogue` folds each row's name once: decorate, filter, sort by (folded, id), undecorate. The answer is the same.
- [ ] **Step 4:** Run `npx jest src/domain`.
  Expected: PASS, with `placePicker.test.ts` and `search.test.ts` unedited.
- [ ] **Step 5: Commit.** Message: `Picker: pair each dive once per logbook, fold each name once (#36)`.

### Task 4: The picker reads only its own table

**Files:**
- Modify: `src/screens/PlacePickerScreen.tsx`
- Test: `src/screens/PlacePickerScreen.test.tsx`

**Interfaces:**
- Consumes: `useDiveSite(id: string | null): DiveSite | null` (`src/db/useDiveSite.ts`, existing).
- Produces:
  - `PlacePickerScreen({ kind })` keeps its signature. It reads the token and the request once, as today, then renders `SitePicker` or `CentrePicker`.
  - Each wrapper calls its own hooks and renders `PickerPage`:
    - `SitePicker`: `useDiveSites`.
    - `CentrePicker`: `useDiveCenters`, plus `useDiveSite(request?.dive.siteId ?? null)`.
  - `PickerPage({ kind, request, places, catalogue: { resolved: boolean; error: Error | undefined }, pairedSite: DiveSite | null })` holds everything the page body does today.

- [ ] **Step 1: Write the failing tests.**
  - Mock `../db/useDiveSite`. In `beforeEach`, implement it from the rows the test gave `mockUseDiveSites`, so the existing *Near [site]* tests keep their fixtures:

    ```ts
    mockUseDiveSite.mockImplementation((id) => mockUseDiveSites.getMockImplementation()?.().sites.find((s) => s.id === id) ?? null);
    ```

    `getMockImplementation` does not count as a call.
  - Add:
    - `it('reads only the sites table on the site picker')`: `mockUseDiveCenters` and `mockUseDiveSite` are not called.
    - `it('reads only the centres table and the dive’s one site on the centre picker')`: `mockUseDiveSites` is not called, and `mockUseDiveSite` is called with the request's `siteId`.
    - `it('offers no Near [site] when the dive’s site is not in the catalogue')` (Review Focus 4): `useDiveSite` returns null, and there is no `nearSite` heading or error.
- [ ] **Step 2:** Run `npx jest src/screens/PlacePickerScreen.test.tsx`. Expected: the two read tests FAIL.
- [ ] **Step 3:** Split the screen as the Interfaces say. Carry the header docblock's "memoised… because it pairs every place with the logbook" sentence over to the new cost: the lookup is built once per logbook.
- [ ] **Step 4:** Run the file again. Expected: PASS, and every existing test passes unedited, apart from the mock wiring in Step 1.
- [ ] **Step 5: Commit.** Message: `Picker: each kind reads its own table, the centre page its one site (#36)`.

### Task 5: The form's place rows read one row by id

**Files:**
- Modify: `src/db/catalogue.ts`. Add `diveCenterRowQuery(db, id)` beside `diveSiteRowQuery`, with the same `pickable` filter and `.limit(1)`. Move `getDiveCenter` onto it.
- Create: `src/db/useDiveCenter.ts`, `src/db/useDiveCenter.test.ts`. Mirror `useDiveSite.ts` and its test.
- Modify: `src/screens/DiveFormScreen.tsx`:
  - `SitePlaceField` and `CentrePlaceField` watch their id and read their one row.
  - `PlaceField` takes `place: CaptionedPlace | null`.
  - `placeCaption` accepts `null`.
- Test: `src/screens/DiveFormScreen.test.tsx`, `src/db/catalogue.test.ts`

**Interfaces:**
- Produces:
  - `diveCenterRowQuery(db: Db, id: string)`
  - `useDiveCenter(id: string | null): DiveCenter | null`

- [ ] **Step 1: Write the failing tests.**
  - `useDiveCenter.test.ts`: the cases `useDiveSite.test.ts` has, for a centre.
  - `catalogue.test.ts`: `getDiveCenter` still refuses a merged or deleted centre, if no test covers it already.
  - `DiveFormScreen.test.tsx`:
    - Mock `../db/useDiveSite` and `../db/useDiveCenter`. Move the two caption tests (around lines 6857 and 7017) onto them.
    - Add `it('reads the Site and Centre rows’ own catalogue rows by id, never a whole table')`: `mockUseDiveSites` and `mockUseDiveCenters` are not called, and `mockUseDiveSite` is called with the dive's `siteId`.
    - Add `it('captions the newly picked site after a pick')` (Review Focus 3): after a pick, `useDiveSite` is called with the new id and the new country shows.
    - Add `it('says on this phone only for a guest’s unsynced site')` (Review Focus 5), unless an existing caption test already asserts it through the new mock.
- [ ] **Step 2:** Run `npx jest src/db/useDiveCenter.test.ts src/db/catalogue.test.ts src/screens/DiveFormScreen.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement as the Files list says. Then remove the form's imports of `useDiveSites` and `useDiveCenters`, and update the `ControlledPlaceField` docblock's last paragraph: each row reads its one row, never a table.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `Dive form: the Site and Centre rows read their one row by id (#36)`.

### Task 6: Measure again, and record it

**Files:**
- Modify: `DESIGN.md`:
  - §10: a new entry, *The picker pairs through a lookup built once per logbook (#36)*. It covers the cause, the numbers before and after, and the fact that `diveBelongsToCatalogueRow` still defines the rule, tested against the lookup.
  - §4.1: add the lookup to `catalogueDives.ts`'s list of deliberate near-duplicates, if §4.1 lists them.
  - §9: remove #36 from the catalogue line's to-do wording, if it reads as open.

- [ ] **Step 1:** Re-apply the temporary `[bench36]` log and repeat Task 1 Step 3 on the same seeded database. Then revert it with `git checkout src/screens/PlacePickerScreen.tsx`.
  Expected: each update in single-digit or low double-digit ms, and no visible lag when typing. If it still lags, find what dominates before adding any cache, and ledger a `Ruling:`.
- [ ] **Step 2:** Restore the simulator's backed-up `ponor.db`.
- [ ] **Step 3:** Write the DESIGN.md entries.
- [ ] **Step 4:** Run `npm run typecheck && npm run lint && npm test -- --ci`. Expected: all green, and no `console.error`.
- [ ] **Step 5: Commit.** Message: `DESIGN.md: record #36's picker lookup and its measurements`.
