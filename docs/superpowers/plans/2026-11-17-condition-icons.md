# Condition icons (#6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ponor's own drawn icon set on the dive form (tile pickers), the dive detail (condition tiles,
depth glyphs, rating dots) and #31's site screens.

**Architecture:** The drawings live as data in one module, and one `ConditionIcon` component renders
them with `react-native-svg`. A field-to-icon function decides which values have a drawing.
`OptionChips` and `TokenChips` gain a tile layout, so selection, carry-over and accessibility keep one
owner each. The dive detail gains a `ConditionTiles` grid built by a pure function.

**Tech Stack:** Expo / React Native, TypeScript, `react-native-svg` 15.15.4 (already a dependency),
Jest + `@testing-library/react-native` (svg elements appear as `RNSVGPath`; see `src/testing/svgPaint.ts`).

**Spec:** `docs/superpowers/specs/2026-11-17-condition-icons-design.md`

## Global Constraints

- Branch `issue-6-condition-icons`, stacked on `issue-31-site-centre-fields`. Rebase onto `main` once PR #62 merges; the PR targets `main` and says `Closes #6`.
- Icon geometry is copied verbatim from the canvas drawings: 40 × 40 viewBox, line stroke 2.0, detail stroke 1.35, round caps and joins, one ink. A knock fills with the ground the icon sits on.
- A scaled group divides its strokes by its scale, so strokes keep their width.
- An icon supplements its label and never replaces it. Words-only values: entry `other`, suit `none`, salinity, material, weighting, suitable-for.
- No hue on icons, tiles or glyphs (§0.1). Only depth figures keep their band colour.
- Every tile keeps the 48 dp floor and uses `minHeight`, never a fixed `height`.
- Tiles: 3 columns with `minHeight` 88; waves 4 columns with `minHeight` 80. The chosen tile is inverted (`selectedFill` / `selectedInk`).
- Public repo: no artifact links, project URLs or personal data in code, commits or the PR.
- CI's checks before every commit that ends a task: `npm run typecheck && npm run lint && npm test -- --ci`.

## Review Focus

1. **Czech labels in a third of 393 pt** (*Jedna láhev*, *Polosuchý*, *Skalní věž*, *Modrá voda*, *Průplav*). They must wrap to a second line, never clip. Pinned in Task 2: the tile label is `numberOfLines={2}` and centred.
2. **A token this build does not know** (a newer client's value) in a tile field. It must stay stored and announced, with no icon and no crash. Pinned in Task 1 (`conditionIconFor` returns `null`) and Task 2 (the tile `TokenChips` keeps it on toggle).
3. **An out-of-range scale on the detail** (`waves = 7`). The tile shows the word the formatter gives, with no icon. Pinned in Task 4.
4. **Large accessibility text.** A fixed height would clip it. Pinned in Task 2 (tile style asserts `minHeight`, no `height`).
5. **A chosen tile in light theme.** The icon's knocks must take the chosen tile's ground, or white patches show on the inverted tile. Pinned in Task 2 (the icon receives `ground` = the selected background).

---

### Task 1: The icon data, `ConditionIcon`, and which values have one

**Files:**
- Create: `src/components/icons/conditionIconData.ts`: `CONDITION_ICONS: Record<ConditionIconName, IconElement[]>`, ported from the canvas drawings. The export is a one-off from the design scripts; no generator goes in the repo.
- Create: `src/components/ConditionIcon.tsx`: the renderer, plus `conditionIconFor`.
- Test: `src/components/ConditionIcon.test.tsx`
- Modify: `DESIGN.md` §0.6: the style paragraph (grid, strokes, knocks) and the set table from the spec §2.

**Interfaces:**
- Produces:
  - `type IconElement = { role: 'line' | 'detail'; d: string; dash?: string } | { role: 'knock'; d: string } | { role: 'dot'; cx: number; cy: number; r: number } | { role: 'group'; transform: string; scale: number; children: IconElement[] }`
  - `type ConditionIconName` = `'entry.shore' | 'entry.boat' | 'waterBody.<ocean|lake|river|quarry|cave|pool>' | 'weather.<sunny|cloudy|overcast|rainy|windy|foggy>' | 'waves.0'…'waves.3' | 'visibility' | 'current' | 'current.none' | 'surge' | 'surge.none' | 'configuration.<single|twinset|sidemount>' | 'suit.<shorty|wet|semidry|dry>' | 'siteType.<wreck|reef|wall|pinnacle|canyon|swim_through|muck|drift|blue_water>' | 'figure.maxDepth' | 'figure.avgDepth'`
  - `ConditionIcon({ name, ink, ground, size = 40 }: { name: ConditionIconName; ink: ColorValue; ground: ColorValue; size?: number }): JSX.Element`
  - `type IconField = 'entry' | 'waterBody' | 'weather' | 'waves' | 'visibility' | 'current' | 'surge' | 'configuration' | 'suit' | 'siteType'`
  - `conditionIconFor(field: IconField, value: string | number | null | undefined): ConditionIconName | null`

- [ ] **Step 1: Write the failing tests**

```tsx
it.each([
  ['entry', 'shore', 'entry.shore'], ['entry', 'other', null],
  ['suit', 'wet', 'suit.wet'], ['suit', 'none', null],
  ['waves', 0, 'waves.0'], ['waves', 3, 'waves.3'], ['waves', 7, null],
  ['visibility', 'low', 'visibility'],
  ['current', 0, 'current.none'], ['current', 2, 'current'],
  ['surge', 0, 'surge.none'], ['surge', 3, 'surge'],
  ['siteType', 'swim_through', 'siteType.swim_through'], ['siteType', 'cavern', null],
  ['waterBody', null, null],
])('conditionIconFor(%s, %p) is %p', (field, value, name) => {
  expect(conditionIconFor(field as IconField, value)).toBe(name);
});
it('has a drawing for every value of every icon vocabulary except the words-only ones', () => { /* loop ENTRY_VALUES, WATER_BODY_VALUES, WEATHER_VALUES, CONDITION_SCALE_VALUES, VISIBILITY_VALUES, CONFIGURATION_VALUES, SUIT_VALUES, SITE_TYPE_VALUES; expect a name exactly for the non-words-only ones and CONDITION_ICONS[name] to exist */ });
it('strokes a line at 2 and a detail at 1.35, in the ink', /* render 'entry.shore', read RNSVGPath strokeWidth and paint() */);
it('fills a knock with the ground, never the ink', /* 'entry.boat' has knocks */);
it('keeps a scaled group's strokes at full width', /* 'siteType.wall' has a group at 0.62: its paths' strokeWidth is 2 / 0.62 inside a 0.62 transform */);
it('draws the dashed None for current with the line dashed', /* 'current.none' paths carry strokeDasharray */);
it('renders at the requested size', /* size 24 → Svg width/height 24, viewBox '0 0 40 40' */);
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/components/ConditionIcon.test.tsx`
Expected: FAIL: cannot find module `./ConditionIcon`.

- [ ] **Step 3: Port the drawings into `conditionIconData.ts`.** Export the final canvas set (the keys above) as the `IconElement` lists, with path strings verbatim. Then implement `ConditionIcon`: a `Svg` with viewBox `0 0 40 40`, one `Path`, `Circle` or `G` per element, `strokeLinecap`/`strokeLinejoin` round, fill `none` except knocks (ground) and dots (ink). Implement `conditionIconFor` from the spec's table. Any value not in the field's vocabulary → `null`.

- [ ] **Step 4: Run to verify they pass.** Run: `npx jest src/components/ConditionIcon.test.tsx`. Expected: PASS.

- [ ] **Step 5: Write DESIGN.md §0.6's style and set paragraphs; run CI's checks; commit.**

```bash
git add src/components/icons src/components/ConditionIcon.tsx src/components/ConditionIcon.test.tsx DESIGN.md
git commit -m "Draw Ponor's own condition icons, and say which values have one (#6)"
```

### Task 2: Tiles on `OptionChips` and `TokenChips`

**Files:**
- Modify: `src/components/OptionChips.tsx`: `layout?: 'chips' | 'tiles'`, `columns?: 3 | 4`, and the `icon` render prop's third argument.
- Modify: `src/components/TokenChips.tsx`: the same `layout`, `columns` and `icon`.
- Modify: `src/theme/styles.ts`: `formTileGrid`, `formTile`, `formTileSelected`, `formTileText`, `formTileTextSelected`, next to `formChip*`. `formTile` copies `formChip`'s border, ground and radius (12), uses `flexDirection: 'column'`, `gap: 6`, `minHeight: 88`, and `flexBasis` per column count with the grid's `gap: 8`.
- Test: `src/components/OptionChips.test.tsx`, `src/components/TokenChips.test.tsx`

**Interfaces:**
- Consumes: `ConditionIcon`, `conditionIconFor` (Task 1).
- Produces:
  - `OptionChipsProps.icon?: (option: T, ink: ColorValue, ground: ColorValue) => ReactNode` (the existing two-argument callers keep compiling).
  - `layout?: 'chips' | 'tiles'` (default `'chips'`), `columns?: 3 | 4` (default 3; 4 means `minHeight` 80), on both components.
  - `TokenChipsProps.icon` with the same signature.

- [ ] **Step 1: Write the failing tests** (same `render`/`queryAll` helpers as the files already use):
  - `it('lays the options out as tiles, three to a row, with the icon above the word')`: `layout="tiles"`; each option is one pressable whose children are the icon, then the label.
  - `it('hands the icon the ink AND the ground the chosen tile wears')`: render with `value='boat'`; the icon callback receives `formTileTextSelected.color` and `formTileSelected.backgroundColor` for boat, and the unselected pair for shore. (Review Focus 5.)
  - `it('wraps a long label to two lines instead of clipping it')`: tile label `numberOfLines === 2`, `textAlign: 'center'`. (Review Focus 1.)
  - `it('grows with the text instead of clipping it')`: flattened tile style has `minHeight` 88 (80 with `columns={4}`) and no `height`. (Review Focus 4.)
  - `it('selects, deselects, announces and carries exactly as chips do')`: re-run the existing press, deselect, `accessibilityState`, carried mark and clear assertions with `layout="tiles"`.
  - TokenChips: `it('keeps a token this build does not offer when a tile is toggled')`: `values={['wreck','cavern']}`, press *Reef*, so `onChange` gets `['wreck','reef','cavern']`. (Review Focus 2.)

- [ ] **Step 2: Run to verify they fail.** `npx jest src/components/OptionChips.test.tsx src/components/TokenChips.test.tsx`. Expected: FAIL on the new tests only.

- [ ] **Step 3: Implement.** A `layout === 'tiles'` branch swaps `formChipRow`/`formChip`/`formChipText` for the tile styles and puts the icon above the label. Behaviour, accessibility and carry code stay shared, with no second copy.

- [ ] **Step 4: Run to verify they pass**, then CI's checks.

- [ ] **Step 5: Commit**

```bash
git add src/components/OptionChips.tsx src/components/TokenChips.tsx src/components/*.test.tsx src/theme/styles.ts
git commit -m "Give the chip rows a tile layout, one owner for choosing either way (#6)"
```

### Task 3: The dive form

**Files:**
- Modify: `src/screens/DiveFormScreen.tsx`:
  - `ControlledOptionField` forwards `layout` and `columns`.
  - Tiles with icons via `conditionIconFor` for: `tanks.0.configuration`, `weather`, `waves` (`columns={4}`), `entry`, `waterBody`, `suit`.
  - `visibility`, `current`, `surge`, `salinity`, `tanks.0.material` and `weightsFeel` stay chips.
  - Max and average depth lead with `figure.maxDepth` / `figure.avgDepth`.
- Modify: `src/components/FormField.tsx`: `leading?: ReactNode`, drawn before the label in `formFieldRow`.
- Delete: `src/components/EntryIcon.tsx`, `src/components/EntryIcon.test.tsx` (SF Symbols retire; `symbolName` stays).
- Test: `src/screens/DiveFormScreen.test.tsx`, `src/components/FormField.test.tsx`

**Interfaces:**
- Consumes: Task 1's icon function and component, Task 2's `layout`/`columns`/`icon(option, ink, ground)`.
- Produces: `FormFieldProps.leading?: ReactNode`.

- [ ] **Step 1: Failing tests.**
  - `it('draws entry, water body, weather, waves, configuration and suit as tiles with their icons')`: each field's options render an `RNSVGPath`, except `Entry: Other` and `Suit: None`, which render none.
  - `it('keeps visibility, current, surge, salinity, material and weighting as word chips')`: no `RNSVGPath` under those options.
  - `it('leads the max and average depth rows with their glyphs')`.
  - FormField: `it('draws a leading mark before the label and announces the label unchanged')`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**, removing `EntryIcon` and its import.
- [ ] **Step 4: Run, expect PASS**, then CI's checks.
- [ ] **Step 5: Commit**: `"Pick the conditions from drawn tiles on the dive form (#6)"`.

### Task 4: The dive detail

**Files:**
- Create: `src/components/ConditionTiles.tsx`: the 3-column grid. Each tile is the icon (or an empty 40 pt box when `icon` is null), the value, and the field name in small caps; an `extra` follows the value in muted mono after a middot.
- Modify: `src/screens/DiveDetailScreen.tsx`:
  - New pure `conditionTiles(dive: Dive, units: UnitSystem): ConditionTile[]`, exported for tests.
  - Order: entry, water body, weather, waves, visibility, current, surge, suit. Each tile appears only when its value is present.
  - The suit tile's `extra` is `formatSuitThickness(dive.suitThicknessMm)` when there is a suit. A thickness with no suit stays a row.
  - Rows that move into tiles leave `whereFields` (entry, water body), `conditionsFields` (visibility, waves, current, surge, weather) and `equipmentFields` (suit, and thickness when it went into the tile).
  - The Conditions cluster (tiles, then its remaining rows) becomes the first cluster after the map and profile cards, as the canvas's whole *Dive detail* draws it.
  - Max and average depth rows lead with their glyphs in muted ink at 24 pt.
  - Rating: `RatingDots`, replacing the `4 / 5` text row.
- Test: `src/components/ConditionTiles.test.tsx`, `src/screens/DiveDetailScreen.test.tsx`
- Modify: `DESIGN.md` §10: one entry each for the one-icon-per-field departure, the dashed *None*, the detail's rating dots, and the Conditions cluster moving first.

**Interfaces:**
- Consumes: Task 1.
- Produces: `type ConditionTile = { key: string; icon: ConditionIconName | null; value: string; label: string; extra?: string }`, `ConditionTiles({ tiles, scheme }: { tiles: ConditionTile[]; scheme: ColorScheme })`.

- [ ] **Step 1: Failing tests.**
  - `conditionTiles` on a full dive: eight tiles in that order. Surge 0 has icon `'surge.none'` and value `None`. The suit tile has `extra` `'5 mm'`.
  - `it('shows a scale it cannot draw as its word, with no icon')`: `waves: 7` gives a tile with `icon: null` and the formatter's word. (Review Focus 3.)
  - `it('keeps a thickness without a suit as a row')`.
  - Detail screen: those values no longer appear as rows; the rating renders five `RatingDot`s with four filled for `rating: 4`; the depth rows carry glyphs; a dive with no conditions draws no tiles and no Conditions heading.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**, then CI's checks.
- [ ] **Step 5: Commit**: `"Show the conditions as tiles on the dive detail, and the rating as dots (#6)"`.

### Task 5: #31's site screens

**Files:**
- Modify: `src/screens/NewPlaceScreen.tsx`: water body as `OptionChips` tiles, and entry and site types as `TokenChips` tiles, with icons from `conditionIconFor`. Salinity and suitable-for stay chips.
- Modify: `src/screens/DiveSiteScreen.tsx`:
  - `SiteFacts` shows site types, water body and the site's entries as `ConditionTiles` in place of their text rows.
  - The water row keeps salinity only.
  - The rows `prefillNote` names must still exist. If #31's review has changed `SiteFacts` by then, follow its final shape.
- Test: `src/screens/NewPlaceScreen.test.tsx`, `src/screens/DiveSiteScreen.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 2, 4 (`ConditionTiles`).

- [ ] **Step 1: Failing tests**:
  - Water body, entry and site types render tiles with icons, and `Entry: Other` has none.
  - Site page: *Wreck · Wall* becomes two tiles, and the water row reads the salinity alone.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS**, then CI's checks.
- [ ] **Step 5: Commit**: `"Pick and show a site's types, water and ways in as tiles (#6)"`.

### Task 6: Records, the device check, and the PR

**Files:**
- Modify: `DESIGN.md` §9: drop the owed icon set; §0.6's closing line on the canvas pages.
- Modify: `CLAUDE.md`: "page *Ponor Reference* has 18 screens" becomes the overview plus group pages (21 screens).

- [ ] **Step 1:** Write the two record changes; run CI's checks; commit `"Record #6 in the design and the project notes"`.
- [ ] **Step 2: Simulator check** (Metro on port 8082 or higher from this worktree). Open a dive with every condition on the form and the detail, a new site, and a site page, in dark and light, English and Czech. Take screenshots for the PR on the `pr-screenshots` branch.
- [ ] **Step 3: After PR #62 merges:** `git fetch && git rebase origin/main`, re-run CI's checks, push `issue-6-condition-icons` (after asking), and open the PR to `main` with `Closes #6` and the screenshots.
