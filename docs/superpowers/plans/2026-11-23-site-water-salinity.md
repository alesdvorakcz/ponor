# Site, water body and salinity as a hierarchy (#53): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setting a parent sets its children: a picked site sets the water body, entry and salinity it knows, and whatever sets the water body sets the salinity. This holds on the dive form and on *New dive site*.

**Architecture:** One pure rule, `salinityFor`, decides the salinity from the water body, a hand-set value still in force, the site, and what was inherited (carry-over in create mode, the stored dive in edit mode, the dive handed to *New dive site*). `siteDefaultFills` gains the site-over-hand-set precedence and calls `salinityFor`. The dive form calls both from gestures only: a site pick, a water-body tap or clear, and its create-mode seed. *New dive site* calls `salinityFor` from its own state.

**Tech Stack:** Expo + TypeScript, react-hook-form, Jest with @testing-library/react-native 14, i18next (en + cs).

**Spec:** GitHub issue #53's body (rewritten 2026-11-23), and the design canvas's #53 board on *Work in progress* (strips `c53d`, `c53a`, `c53b`, `c53c`).

## Global Constraints

- Ocean: the Salinity row is not drawn, and the value is `salt`.
- Any other water body: the site's or the inherited salinity when it was recorded for that same water body; otherwise `fresh`, captioned `from the water body` / `podle vodní plochy`.
- No water body: the row works as it does today.
- A salinity set by hand lasts until the water body changes.
- A site pick sets what the site knows (water body, entry when it offers exactly one way in, salinity), over values set by hand. A field the site doesn't know keeps a hand-set value, and a value the previous site filled falls back to the inherited one, never to the old site's.
- Edit mode: the rule runs only on the diver's own site change or water-body gesture. Opening a saved dive never rewrites a value.
- *Water & entry* order: Entry, Water body, Salinity. *New dive site*'s *The site*: Water body, Salinity, Entry.
- Stored values, sync and export are unchanged. No migration.
- Build against the existing tokens and styles; no colour literals. Copy lives in i18n, in en and cs.
- No attribution lines in commits or the PR. Issues, PRs and commits are public: no artifact links.

## Review Focus

1. **A reseed after a gesture** (`useDives()` landing a newer dive while the form is open) keeps a rule-set salinity and its caption, and adds no carried mark. Task 3 tests it.
2. **A site read that lands after the diver tapped a water body** derives the salinity from the water body the form holds when the answer lands, not the one it held at the tap. Task 2 tests it.
3. **Clearing a carried water body with its ring** leaves the salinity as no-water-body says (the inherited value), not stuck on a rule-filled *Fresh* with its caption. Task 3 tests it.
4. **A legacy ocean dive stored with `fresh`, opened in edit mode and saved untouched**, keeps `fresh`, because opening never refills. Task 3 tests it.
5. **A site offering several ways in** leaves a hand-set entry alone, because a set of several says nothing. Task 1 tests it.

---

### Task 1: The rule in `domain/siteDefaults.ts`

**Files:**
- Modify: `src/domain/siteDefaults.ts` (add `salinityFor`; rework `siteDefaultFills`)
- Test: `src/domain/siteDefaults.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SalinitySource = 'typed' | 'site' | 'inherited' | 'waterBody';
  export interface SalinityAnswer { readonly value: string | null; readonly source: SalinitySource | null; readonly shown: boolean }
  export function salinityFor(input: {
    waterBody: unknown;                 // the water body the dive holds now
    typed: string | null | undefined;   // a hand-set salinity still in force; undefined = none in force
    site: SiteDefaults | null;
    inherited: InheritedValues;         // carry-over, the stored dive, or the dive handed to New dive site
  }): SalinityAnswer;
  export interface SiteDefaultFill { readonly field: SiteDefaultField; readonly value: string | null; readonly fromSite: boolean; readonly fromWaterBody: boolean }
  export function siteDefaultFills(site: SiteDefaults | null, inherited: InheritedValues, typed: ReadonlySet<string>, current: InheritedValues,
    keep?: ReadonlySet<string>): { fills: SiteDefaultFill[]; released: SiteDefaultField[] };
  ```
  `released` names the hand-set fields this pick overrode. The caller drops them from `typed` and `cleared`.

  `keep` names the fields the diver touched after the pick began, while the site read was in flight. The latest gesture wins, so these are treated as hand-set and the site never overrides them. For example: pick a site, tap *River* while the read is out, and *River* stays when a `lake` site answers. A kept salinity stays in force whatever the water body.

`salinityFor` decides in this order, taking the first that answers. Every value goes through the existing `stated()`, so `wb` below is `stated(waterBody)`.

1. `wb === 'ocean'` → `{ value: 'salt', source: 'waterBody', shown: false }`.
2. The site states a salinity, and its water body is unstated or equals `wb` → `'site'`.
3. `typed !== undefined` → `{ value: stated(typed), source: 'typed' }`.
4. The inherited salinity is stated and `stated(inherited.waterBody) === wb` → `'inherited'`.
5. `wb !== null` → `{ value: 'fresh', source: 'waterBody' }`.
6. Otherwise → the inherited salinity (`'inherited'`), or `{ value: null, source: null }`.

`shown` is true everywhere except step 1.

`siteDefaultFills` works in this order:

1. **Entry and water body.** A value the site supplies (`siteDefaultValue`) fills the field, and a hand-set field it overrides goes into `released`. Otherwise a hand-set field gets no fill, and any other field is filled from the inherited value. `fromSite` keeps its old meaning: the site supplied the value, and it differs from the inherited one.
2. **The water body that results.** `wb` is the water body's fill when it has one, else `stated(current.waterBody)`.
3. **Salinity.** A hand-set salinity is still in force only if `wb === stated(current.waterBody)`. If the water body changed, `'salinity'` goes into `released`. Call `salinityFor`. A `'typed'` answer gets no fill. Any other answer fills the field, with `fromSite` for a `'site'` source that differs from the inherited salinity, and `fromWaterBody` for `'waterBody'`. A `'site'` answer over a hand-set salinity also goes into `released`.

- [ ] **Step 1: Write the failing tests** (top-level `it`s, in the file's style)

```ts
it('saves salt for an ocean and hides the row, whatever else says otherwise', () => {
  const site = { entry: [], salinity: 'fresh', waterBody: 'ocean' } as SiteDefaults;
  expect(salinityFor({ waterBody: 'ocean', typed: 'fresh', site, inherited: { salinity: 'fresh', waterBody: 'ocean' } }))
    .toEqual({ value: 'salt', source: 'waterBody', shown: false });
});
it.each(['lake', 'river', 'quarry', 'cave', 'pool'])('answers fresh for a %s nothing else speaks for', (wb) => {
  expect(salinityFor({ waterBody: wb, typed: undefined, site: null, inherited: {} })).toEqual({ value: 'fresh', source: 'waterBody', shown: true });
});
it('takes a site’s salt for its own water body (Lake · Salt gives Lake · Salt)', () => {
  const site = { entry: [], salinity: 'salt', waterBody: 'lake' } as SiteDefaults;
  expect(salinityFor({ waterBody: 'lake', typed: undefined, site, inherited: {} }).value).toBe('salt');
  expect(salinityFor({ waterBody: 'river', typed: undefined, site, inherited: {} })).toMatchObject({ value: 'fresh', source: 'waterBody' });
});
it('takes a site’s salinity when the site names no water body', () => {
  const site = { entry: [], salinity: 'salt', waterBody: null } as SiteDefaults;
  expect(salinityFor({ waterBody: 'lake', typed: undefined, site, inherited: { salinity: 'fresh', waterBody: 'lake' } }).source).toBe('site');
});
it('keeps a carried salinity only with the water body it carried with', () => {
  const inherited = { salinity: 'salt', waterBody: 'lake' };
  expect(salinityFor({ waterBody: 'lake', typed: undefined, site: null, inherited })).toMatchObject({ value: 'salt', source: 'inherited' });
  expect(salinityFor({ waterBody: 'river', typed: undefined, site: null, inherited })).toMatchObject({ value: 'fresh', source: 'waterBody' });
});
it('keeps a hand-set salinity in force, cleared included', () => {
  expect(salinityFor({ waterBody: 'lake', typed: 'salt', site: null, inherited: {} })).toMatchObject({ value: 'salt', source: 'typed' });
  expect(salinityFor({ waterBody: 'lake', typed: '', site: null, inherited: {} })).toMatchObject({ value: null, source: 'typed' });
});
it('works as before with no water body', () => {
  expect(salinityFor({ waterBody: null, typed: undefined, site: null, inherited: { salinity: 'salt', waterBody: 'ocean' } })).toMatchObject({ value: 'salt', source: 'inherited' });
  expect(salinityFor({ waterBody: null, typed: undefined, site: null, inherited: {} })).toEqual({ value: null, source: null, shown: true });
});
it('lets a site override a hand-set water body and entry, and releases them', () => { /* typed {waterBody, entry}, site {waterBody:'ocean', entry:['shore']} → fills ocean/shore, released ['entry','waterBody'] */ });
it('keeps a hand-set entry when the site offers several ways in', () => { /* site entry ['shore','boat'] → no entry fill, entry not released */ });
it('drops a hand-set salinity when the pick changes the water body, and keeps it when it does not', () => { /* current lake+salt typed; site river → fresh fill, released salinity; site lake (no salinity) → no salinity fill */ });
it('fills fresh from the water body when a lake site replaces a carried ocean', () => { /* inherited ocean+salt, site lake → salinity fill fresh, fromWaterBody true */ });
it('never overrides a field the diver touched while the read was out', () => { /* typed+keep {waterBody}, current river, site lake+salt → no waterBody fill, nothing released, salinity fill fresh */ });
```

Write the bodies of the last five from their comments, against `siteDefaultFills`. The existing `siteDefaultFills` tests move to the new return shape (`.fills`) and keep their assertions. The one asserting that a typed field is skipped whatever the site says changes to the site-overrides version above.

- [ ] **Step 2:** Run `npx jest src/domain/siteDefaults.test.ts`. Expected: FAIL (`salinityFor` is not exported; `siteDefaultFills` returns an array).
- [ ] **Step 3:** Implement both in `src/domain/siteDefaults.ts`. Rewrite `siteDefaultFills`' docblock: the three tiers become the hierarchy, and the reversal of §2.1's tier one is the owner's call of 2026-11-23.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** `npx tsc --noEmit` shows the one caller (`DiveFormScreen.tsx` `applySiteDefaults`) failing on the new shape. That is expected; Task 2 fixes it. Commit only after Task 2 compiles. Tasks 1 and 2 share one commit: `Site defaults: a site sets what it knows, and the water body sets the salinity (#53)`.

### Task 2: The dive form's site pick (create and edit)

**Files:**
- Modify: `src/screens/DiveFormScreen.tsx`. Touch `applySiteDefaults` (~3205), `SeedState` (377) plus `seedStateFor` (577) for the new set, `noteTouched` (3002), and add `pairedSiteRef`.
- Test: `src/screens/DiveFormScreen.test.tsx`, section "M2s" (7051–7558), using its fixtures `siteSaying`, `stubCatalogueRows`, `pickSite`, `chosenChip`, `waterRows`.

**Interfaces:**
- Consumes: `siteDefaultFills`, `salinityFor` (Task 1).
- Produces:
  - `SeedState.fromWaterBody: ReadonlySet<string>` (only ever `'salinity'`). It is revisable like `fromSite` and passes through `seedStateFor` as its new last parameter.
  - `pairedSiteRef: MutableRefObject<SiteDefaults | null>`: the defaults of the site the last pick answered with, `null` when unpaired.

Changes to `applySiteDefaults`:

- **The guard and the read.** Drop the `mode !== 'create'` guard. Read `current` for the three fields with `getValues()` **after** the await, which pins Review Focus 2.
- **Fields touched during the read.** Add a ref, `touchedSincePickRef: MutableRefObject<Set<string>>`. `applySiteDefaults` resets it before its await, and `noteTouched` adds to it. After the await it is passed as `keep`.
- **Where the values come from.** Set `pairedSiteRef.current = site`. Take `inherited` from `carriedRef.current.values`, as today.
- **Applying each fill.** Write it with `shouldDirty: true`. Then update the marks:
  - `released` fields leave `typed` and `cleared`;
  - `fromWaterBody` fills join `fromWaterBody`;
  - `fromSite` fills join `fromSite`;
  - an inherited fill joins `paths` **only in create mode**, since edit mode never shows a carried mark.
- **`noteTouched`.** It also deletes the field from `fromWaterBody`.

- [ ] **Step 1: Write the failing tests**
  - `it('lets a picked site replace a water body and entry the diver tapped')`. Tap *Boat* and *Lake*, then pick a site with `entry: ['shore'], waterBody: 'ocean'`. Expect `chosenChip(t,'Entry',…)` → *Shore*, the water body → *Ocean*, and no `Salinity` row. A save writes `salinity: 'salt'`.
  - `it('keeps the diver’s entry when the picked site knows only its water body')`. Tap *Boat*, then pick a site with `waterBody: 'river'`. Expect *Boat*, *River*, and *Fresh* with the caption `from the water body`.
  - `it('gives a site’s own pair, Lake · Salt')`. Expect *Lake*, *Salt*, and no caption.
  - `it('derives the salinity from the water body the form holds when a slow site read lands')`. Hold the read, tap *River*, then release a site with no water body that says salt. Expect *River* + *Salt*, because a site with no water body speaks for any water body (rule step 2). Then repeat with a site that says `lake`+`salt` and expect *River* + *Fresh*.
  - **Invert** `it('never prefills a dive it is editing, whatever site the diver moves it to')` (7366) into `it('prefills a dive it is editing when the diver moves it to another site, and only then')`. Opening alone writes nothing; a pick of an ocean site writes ocean/salt; the stored entry stays when the site offers several ways in.
  - **Update** `it('puts the diver above the site…')` (7134) to the site-overrides rule for a field the site states. Keep its "site says nothing" half as is.
- [ ] **Step 2:** Run `npx jest src/screens/DiveFormScreen.test.tsx -t "site"`. Expected: the new and inverted tests FAIL, and the rest of M2s still PASSES.
- [ ] **Step 3:** Implement the changes listed above. Update the docblock above `applySiteDefaults`: its "the one thing this rule may never overwrite" no longer holds for a field the site states.
- [ ] **Step 4:** Run the same command. Expected: PASS. Then run the whole file.
- [ ] **Step 5:** `npm run typecheck`, then commit together with Task 1.

### Task 3: The water body sets the salinity on the dive form

**Files:**
- Modify: `src/screens/DiveFormScreen.tsx`. This covers `ControlledOptionField` (1477–1566), `FORM_GROUPS.water.fields` (780), the Water & entry JSX (~4003), `seedStateFor`'s create branch, and a new `onWaterBodyPicked` callback.
- Modify: `src/i18n/en.ts` and `src/i18n/cs.ts`. Add the key `field.fromWaterBody`: `'from the water body'` / `'podle vodní plochy'`.
- Test: `src/screens/DiveFormScreen.test.tsx`

**Interfaces:**
- Consumes: `salinityFor`, `pairedSiteRef`, `SeedState.fromWaterBody` (Tasks 1–2).
- Produces:
  - `ControlledOptionFieldProps.caption?: string`, forwarded to `OptionChips`.
  - `ControlledOptionFieldProps.onPicked?: (previous: unknown, chosen: T | '') => void`, called after `field.onChange` from both the chip press and the clear ring.

The pieces, in order:

1. **`onWaterBodyPicked(previous, chosen)`.** If `stated(previous) === stated(chosen)`, it does nothing. Otherwise it computes `salinityFor({ waterBody: chosen, typed: undefined, site: pairedSiteRef.current, inherited: carriedRef.current.values })` and writes the value with `setValue('salinity', value, { shouldDirty: true })`. Then it updates the marks:
   - `'salinity'` leaves `typed` and `cleared`;
   - `fromSite` / `fromWaterBody` / `paths` hold `'salinity'` exactly when the source is `'site'` / `'waterBody'` / `'inherited'`, and `paths` only in create mode.
2. **The seed, create mode only.** Unless `'salinity'` is in `typed` or `fromSite`, run `salinityFor` over the seeded values with `site: null`. A `'waterBody'` answer writes `values.salinity`, removes `'salinity'` from `marked`, and adds it to `fromWaterBody`. Edit mode is untouched, which is Review Focus 4.
3. **Render.**
   - Read the water body with `useWatch({ control, name: 'waterBody' })`.
   - Draw Entry, then Water body (with `onPicked={onWaterBodyPicked}`), then Salinity.
   - Salinity is drawn only when the water body isn't `ocean`, with `caption={carried.fromWaterBody.has('salinity') ? t('field.fromWaterBody') : undefined}`.
   - `FORM_GROUPS.water.fields` becomes `['entry', 'waterBody', 'salinity', 'latitude', 'longitude']`.

- [ ] **Step 1: Write the failing tests**
  - Update the `SECTION_ORDER` row (778) to `['Water & entry', ['entry', 'waterBody', 'salinity', …]]`, so the order tests at 974/999 fail first.
  - `it('hides Salinity for an ocean and saves salt')`. Tap *Ocean*: no `Salinity:` chip is found, and the save writes `salinity: 'salt'`.
  - `it('brings Fresh, from the water body, when the diver taps Lake')`. The caption is found in the Salinity row, and there is no carried mark.
  - `it('keeps a salt carried with its lake, marked as carried')`. The carry-over is `lake`+`salt`: *Salt*, the carried mark, and no caption.
  - `it('seeds Fresh from the water body when the last dive named a lake and no salinity')`.
  - `it('seeds salt and no row when the last dive was in the ocean')`.
  - `it('drops a Salt set by hand when the water body changes')`. Tap *Lake*, then *Salt*, then *River*: *Fresh* with the caption.
  - `it('keeps the rule’s salinity when carry-over resolves again')` (Review Focus 1). Copy the pattern of "keeps the site's answers when carry-over resolves again" (7252).
  - `it('lets the salinity fall back when the diver clears a carried water body')` (Review Focus 3). Carry-over is `lake`+`salt`, tap *River* (*Fresh*), then clear the water body: *Salt*, inherited, with no caption.
  - `it('leaves a stored ocean dive’s fresh alone when it is saved untouched')` (Review Focus 4). Use `writtenPatch`; the patch has no `salinity` key.
- [ ] **Step 2:** Run `npx jest src/screens/DiveFormScreen.test.tsx`. Expected: the new and order tests FAIL.
- [ ] **Step 3:** Implement. Rewrite the Water & entry JSX comment for the new order and the hidden row.
- [ ] **Step 4:** Run the file. Expected: PASS. Check the i18n parity test with `npx jest src/i18n`.
- [ ] **Step 5:** Commit: `Dive form: the water body sets the salinity, and ocean hides the row (#53)`.

### Task 4: *New dive site* follows the same rule

**Files:**
- Modify: `src/screens/NewPlaceScreen.tsx`. Change its salinity and water-body state (213–214) and *The site*'s JSX (600–635).
- Test: `src/screens/NewPlaceScreen.test.tsx`, using its helpers `labelled`, `press`, `count`, `expand`, `diveAt`.

**Interfaces:**
- Consumes: `salinityFor` (Task 1) and `field.fromWaterBody` (Task 3).

How it behaves:

1. **The starting salinity.** It is `salinityFor({ waterBody: dive?.waterBody, typed: undefined, site: null, inherited: { waterBody: dive?.waterBody, salinity: dive?.salinity } })`. A new state, `salinityFromWaterBody: boolean`, records whether the rule supplied it.
2. **A water-body tap.** It runs the same call with the new water body and sets both states.
3. **A salinity tap.** It sets the salinity and `salinityFromWaterBody: false`.
4. **The Salinity row's caption.** It shows `t('field.fromWaterBody')` when the rule supplied the value, and `fromDive(salinity, dive?.salinity)` otherwise.
5. **Layout.** The order is Water body, Salinity, Entry, and Salinity isn't drawn for `ocean`.
6. **Saving.** The save sends the salinity state, which is `salt` for an ocean.

- [ ] **Step 1: Write the failing tests**
  - Update `it('prefills the typed name, the dive's pin, salinity, water body and entry')` (238). Its `count(t,'from this dive')` stays 4 for a `lake`+`salt` dive.
  - `it('draws Water body before Salinity before Entry')`.
  - `it('hides Salinity for an ocean dive and saves salt')`.
  - `it('brings Fresh, from the water body, when the diver taps Lake on an ocean dive’s site')`.
  - `it('says from the water body in Czech')`, in the existing describe `in Czech` (1707): `podle vodní plochy`.
- [ ] **Step 2:** Run `npx jest src/screens/NewPlaceScreen.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the file. Expected: PASS.
- [ ] **Step 5:** Commit: `New dive site: the water body sets the salinity, in the same order (#53)`.

### Task 5: Record it, check it, open the PR

**Files:**
- Modify: `DESIGN.md`:
  - §2.1's *Site defaults* paragraph: the hierarchy, and edit mode on the diver's own site change;
  - §2.2's group table (line ~297): `entry · water body · salinity · GPS pin`;
  - line ~186, *The site*'s order: Water body, Salinity, Entry;
  - a §10 entry recording the owner's call, the reversal of tier one for site picks and for salinity, and why (the parent sets its children).

- [ ] **Step 1:** Make the DESIGN.md edits. Grep `DiveSiteScreen.tsx`'s note (`siteDefaultValue` users) to confirm it still names what a pick fills.
- [ ] **Step 2:** Run CI's exact checks with `npm run typecheck && npm run lint && npm test -- --ci`. Expected: all pass, with no `console.error` output.
- [ ] **Step 3:** Commit: `DESIGN.md: site, water body and salinity are a hierarchy (#53)`.
- [ ] **Step 4:** Rebase on `main`, gate the push on the checks (`&&`), and open the PR. Its body says `Closes #53`, with a decisions summary, the tests, and a mutation table. Put no canvas link in it.
- [ ] **Step 5:** After the merge, move the settled board from *Work in progress* to F · Foundations, next to strip 1. This is a canvas publish, not part of the PR.
