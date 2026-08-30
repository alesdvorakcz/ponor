# M1c · The Design Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the built screens up to the composition rules in `DESIGN.md` §0.6, and fix the three product defects the design review surfaced.

**Architecture:** Almost all of this is a restyle: the data layer, the screens' logic and their tests are correct and stay put. Changes concentrate in `src/theme/styles.ts` (the single place tokens meet style properties) and in how components compose what they already receive. Three tasks are behavioural rather than visual — MOD per cylinder, planned dives showing their date, and hand-ordering moving behind a day strip.

**Tech Stack:** Expo SDK 57 · React Native 0.86 · React 19.2 · TypeScript · `StyleSheet` via `src/theme/styles.ts` · Jest + `@testing-library/react-native`.

## Global Constraints

Copied from `DESIGN.md`. These bind every task.

- **Colour encodes depth and nothing else.** Colours come from `makeStyles(scheme)` or `depthColorOrNull(metres, scheme)`. A colour literal in a component is a defect; the ESLint rule covers `src/app/**`, `src/components/**`, `src/screens/**`.
- **`DepthValue` is the only component permitted to touch the depth scale.**
- **Fonts come from `src/theme/fonts.ts`**, never a hardcoded family string. Data is IBM Plex Mono; UI is Archivo; `fontVariant: ['tabular-nums']` wherever digits align in a column.
- **No profile, sparkline or chart of any kind.** No dive carries a sample series in v1 (§0.4). This milestone draws none.
- **All dive fields are nullable except `date`.** A dive carrying only a date must render with no `null`, no `NaN`, no placeholder dash.
- **Never render a computed value the domain returned `null` for.**
- **Dive numbers are computed, never stored.** Planned dives carry none.
- **Never re-state the ordering tiers** (`date` → `timeIn` → `manualOrder` → `createdAt` → `id`). `compareDiveOrder` owns them.
- **Nothing but real routes under `src/app/`.** expo-router sweeps that directory; a test file there breaks the app launch while every static gate stays green. Screens live in `src/screens/`, components in `src/components/`, tests beside them.
- **Verify with `npx expo export --platform ios`** — it must succeed. Do *not* curl the dev server's `entry.bundle`: it was measured returning byte-identical output for broken and fixed trees, so it cannot fail.
- Tap targets never below **48 dp**; the primary action sits in the bottom third.
- Labels wrap to two lines rather than truncate — Czech runs 20–30 % longer than English.
- Tests must be able to fail. **Six times on this project a test's fixture could not reach the code path it claimed to cover.** Before trusting a passing test, break the code under it and watch it redden. Pick fixtures that sit *on* the boundary being tested.

## Verified facts, so no task rediscovers them

- Theme token keys are `bg`, `surface`, `border`, `fg`, `fgMuted`, `action`, `actionFg`. **There is no `fg-muted`.**
- Font keys are `sans`, `sans-medium`, `sans-semibold`, `sans-bold`, `mono`, `mono-medium`, `mono-semibold`.
- `@testing-library/react-native@14`'s `render()` is **async** and its `root` exposes `queryAll(predicate)`, not `findAllByType`. `await render(...)`. Both screen test files already define a `textIn` helper — read one before writing a harness.
- **Where a code sample below disagrees with the type-scale table or the Global Constraints, the table and the constraints win.** Task 2 found five defects in its own sample, two of which contradicted this document a few dozen lines above. Treat samples as illustration, not authority.
- Any style that backs a *control* needs `minHeight: 48`. Text and decorative views do not.
- A text node that must wrap beside a sibling needs `flex: 1` — React Native's default `flexShrink` is 0, so without it the text overflows instead of wrapping. This matters for every site name, because Czech runs 20–30 % longer than English.

## The type scale (§0.6)

Every size below is specified. Do not invent one.

| Element | Face | Size | Treatment |
|---|---|---|---|
| Depth value — row | Plex Mono Medium | 20 | Band colour, tabular, right-aligned |
| Depth value — detail hero | Plex Mono Medium | 34 | Band colour, tabular |
| Site name | Archivo Medium | 16 | Wraps to two lines, never truncates |
| Trip header | Archivo SemiBold | 11.5 | Uppercase, +0.13 em tracking, muted |
| Trip date range | Plex Mono | 11 | Muted, trailing edge |
| Dive number | Plex Mono | 11 | Muted, above the site name |
| Row metadata | Plex Mono | 11.5 | Middot-separated |
| Cluster label | Plex Mono | 10.5 | Uppercase, +0.14 em, muted |
| Computed value | Plex Mono | 13.5 | Muted ink + a 6 px outlined marker on the label |

---

## File structure

**Modified**

| File | Change |
|---|---|
| `src/theme/styles.ts` | The bulk of the work — the new scale, row composition, cluster and marker styles. |
| `src/components/DiveRow.tsx` | Recompose: number above site, depth as the anchor. |
| `src/components/TripHeader.tsx` | Uppercase tracked label, mono date range. |
| `src/components/DepthValue.tsx` | Accept a size variant (row / hero). |
| `src/components/ReorderControls.tsx` | Arrows take the depth slot; row height unchanged. |
| `src/screens/DivesScreen.tsx` | Day strip, quieter search, planned dives show their date. |
| `src/screens/DiveDetailScreen.tsx` | Hero, computed-value markers, MOD per cylinder. |

**Created**

| File | Responsibility |
|---|---|
| `src/components/DayStrip.tsx` | The reorder affordance for one day, and the sentence explaining why that day qualifies. |

---

## Task 1: The type scale and row composition

The row currently sets number, site and depth at near-identical sizes, which is why nothing reads. §0.6 makes depth the anchor.

**Files:**
- Modify: `src/theme/styles.ts`, `src/components/DiveRow.tsx`, `src/components/DepthValue.tsx`
- Test: `src/components/DiveRow.test.tsx`, `src/components/DepthValue.test.tsx`

**Interfaces:**
- Consumes: `makeStyles(scheme)`, `depthColorOrNull(metres, scheme)`, `formatDepth`, `formatDuration`, `formatTimeRange`.
- Produces: `<DepthValue metres={number|null} scheme={ColorScheme} variant="row"|"hero" />` — `variant` defaults to `"row"`, so existing call sites keep working.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/DiveRow.test.tsx`:

```tsx
it('sets the depth larger than the site name, so the row has an anchor', async () => {
  const d = dive({ siteName: 'Blue Hole', maxDepthM: 32.4 });
  const t = await render(<DiveRow dive={d} number={1} scheme="dark" onPress={() => {}} />);
  const sizeOf = (s: string) => {
    const node = t.root.queryAll((n: any) => n.type === 'Text')
      .find((n: any) => String(n.children[0] ?? '').includes(s));
    return [node?.props.style].flat(3).filter(Boolean)
      .reduce((acc: number, st: any) => st?.fontSize ?? acc, 0);
  };
  expect(sizeOf('32.4')).toBe(20);
  expect(sizeOf('Blue Hole')).toBe(16);
  expect(sizeOf('32.4')).toBeGreaterThan(sizeOf('Blue Hole'));
});

it('gives the depth tabular figures so a column of dives aligns', async () => {
  const d = dive({ maxDepthM: 9.2 });
  const t = await render(<DiveRow dive={d} number={1} scheme="dark" onPress={() => {}} />);
  const node = t.root.queryAll((n: any) => n.type === 'Text')
    .find((n: any) => String(n.children[0] ?? '').includes('9.2'));
  const style = [node?.props.style].flat(3).filter(Boolean);
  expect(style.some((s: any) => s?.fontVariant?.includes('tabular-nums'))).toBe(true);
});

it('lets a long site name wrap rather than truncate', async () => {
  const d = dive({ siteName: 'Šenkýřův lom u Zbraslavi nad Vltavou' });
  const t = await render(<DiveRow dive={d} number={1} scheme="dark" onPress={() => {}} />);
  const node = t.root.queryAll((n: any) => n.type === 'Text')
    .find((n: any) => String(n.children[0] ?? '').includes('Šenkýřův'));
  expect(node?.props.numberOfLines).toBe(2);
  expect(node?.props.ellipsizeMode).not.toBe('head');
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx jest DiveRow -t 'anchor'`
Expected: FAIL — the depth is currently smaller than 20 and the same size as the site.

- [ ] **Step 3: Add the scale to `src/theme/styles.ts`**

Update the existing `diveNumber`, `diveSite`, `diveChip`, `depthValue` keys and add `depthValueHero`:

```ts
diveNumber:   { fontFamily: fonts.mono, fontSize: 11, color: theme.fgMuted, letterSpacing: 0.4 },
diveSite:     { fontFamily: fonts['sans-medium'], fontSize: 16, color: theme.fg, lineHeight: 20 },
diveChip:     { fontFamily: fonts.mono, fontSize: 11.5, color: theme.fgMuted },
depthValue:   { fontFamily: fonts['mono-medium'], fontSize: 20, lineHeight: 22,
                fontVariant: ['tabular-nums'], letterSpacing: -0.4, textAlign: 'right' },
depthValueHero:{ fontFamily: fonts['mono-medium'], fontSize: 34, lineHeight: 36,
                fontVariant: ['tabular-nums'], letterSpacing: -1 },
depthUnit:    { fontFamily: fonts.mono, fontSize: 11, opacity: 0.62 },
depthUnitHero:{ fontFamily: fonts.mono, fontSize: 13, opacity: 0.62 },
```

Use the exact font keys that already exist in `src/theme/fonts.ts` — read it first and match them rather than guessing at `mono-medium`.

- [ ] **Step 4: Give `DepthValue` a variant**

```tsx
export function DepthValue({ metres, scheme, variant = 'row' }: DepthValueProps) {
  const colour = depthColorOrNull(metres, scheme);
  const text = formatDepth(metres);
  if (colour === null || text === null) return null;
  const styles = makeStyles(scheme);
  // formatDepth returns "32.4 m"; the unit is set apart so it can be quieter than
  // the number without a second call into the formatter.
  const [value, unit] = text.split(' ');
  return (
    <Text style={[variant === 'hero' ? styles.depthValueHero : styles.depthValue, { color: colour }]}>
      {value}
      <Text style={variant === 'hero' ? styles.depthUnitHero : styles.depthUnit}>{` ${unit}`}</Text>
    </Text>
  );
}
```

Note the split: `formatDepth` is still the only place that decides the string. Do not re-implement the formatting here.

- [ ] **Step 5: Recompose the row**

Number above the site name, metadata below, `DepthValue` at the trailing edge, baseline-aligned to the site. Keep `React.memo`, keep the 48 dp minimum, keep `numberOfLines={2}` on the site.

- [ ] **Step 6: Run the suite**

Run: `npm test && npm run typecheck && npm run lint && npx eslint .`
Expected: all pass. Report the new count (baseline **405**).

- [ ] **Step 7: Prove one assertion can fail**

Change `depthValue`'s `fontSize` to `16` and run `npx jest DiveRow -t 'anchor'`. It must fail on the size comparison, not merely on the exact value. Restore it and report both results.

- [ ] **Step 8: Commit**

```bash
git add src/theme/styles.ts src/components/DiveRow.tsx src/components/DepthValue.tsx src/components/DiveRow.test.tsx src/components/DepthValue.test.tsx
git commit -m "Make the depth value the anchor of a dive row"
```

---

## Task 2: Trip headers and the search field

**Files:**
- Modify: `src/theme/styles.ts`, `src/components/TripHeader.tsx`, `src/screens/DivesScreen.tsx`
- Test: `src/screens/DivesScreen.test.tsx`

**Interfaces:**
- Consumes: `makeStyles(scheme)`, the `Trip` shape from `src/domain/trips.ts` (`{ key, title, dateRange, dives }`).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

```tsx
it('sets trip headers apart from row text rather than merely bolding them', async () => {
  (useDives as jest.Mock).mockReturnValue({
    dives: [dive({ date: '2026-08-16', siteName: 'Blue Hole', maxDepthM: 32.4 })],
    numbers: new Map(), error: undefined,
  });
  const t = await render(<DivesScreen />);
  const header = t.root.queryAll((n: any) => n.type === 'Text')
    .find((n: any) => String(n.children[0] ?? '') === 'BLUE HOLE'
                   || String(n.children[0] ?? '') === 'Blue Hole');
  const style = [header?.props.style].flat(3).filter(Boolean);
  expect(style.some((s: any) => s?.textTransform === 'uppercase')).toBe(true);
  expect(style.some((s: any) => (s?.letterSpacing ?? 0) >= 1)).toBe(true);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest DivesScreen -t 'trip headers'`
Expected: FAIL — no `textTransform` on the header today.

- [ ] **Step 3: Restyle**

```ts
tripHeader:    { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
                 paddingTop: 20, paddingBottom: 7, paddingHorizontal: 16, backgroundColor: theme.bg },
tripTitle:     { fontFamily: fonts['sans-semibold'], fontSize: 11.5, color: theme.fg,
                 textTransform: 'uppercase', letterSpacing: 1.5 },
tripDateRange: { fontFamily: fonts.mono, fontSize: 11, color: theme.fgMuted },
searchInput:   { fontFamily: fonts.mono, fontSize: 12.5, color: theme.fg,
                 backgroundColor: theme.surface, borderRadius: 9,
                 paddingVertical: 9, paddingHorizontal: 12, marginHorizontal: 12, marginBottom: 8 },
```

The search field loses its border. It is the heaviest object at the top of the screen today and the one a diver touches least.

- [ ] **Step 4: Run the suite**

Run: `npm test && npm run typecheck`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/theme/styles.ts src/components/TripHeader.tsx src/screens/DivesScreen.tsx src/screens/DivesScreen.test.tsx
git commit -m "Give trip headers their own voice and quieten the search field"
```

---

## Task 3: Planned dives say when

§3 pins planned dives under "Up next". Today the row shows a site and nothing else — for a section whose entire purpose is *when*.

**Files:**
- Modify: `src/components/DiveRow.tsx`, `src/screens/DivesScreen.tsx`
- Test: `src/components/DiveRow.test.tsx`

**Interfaces:**
- Consumes: `formatDiveDate(date)` from `src/format/display.ts`.

- [ ] **Step 1: Write the failing test**

```tsx
it('shows a planned dive its date, since "Up next" is about when', async () => {
  const d = dive({ status: 'planned', date: '2026-09-05', siteName: 'Silfra' });
  const t = await render(<DiveRow dive={d} number={undefined} scheme="dark" onPress={() => {}} />);
  const text = t.root.queryAll((n: any) => n.type === 'Text')
    .flatMap((n: any) => n.children).filter((c: any) => typeof c === 'string').join(' ');
  expect(text).toContain('5 Sep 2026');
  expect(text).not.toMatch(/#\d/);
});

it('does not put the date on a logged dive row, where the trip header carries it', async () => {
  const d = dive({ status: 'logged', date: '2026-09-05', siteName: 'Silfra', timeIn: '09:00' });
  const t = await render(<DiveRow dive={d} number={7} scheme="dark" onPress={() => {}} />);
  const text = t.root.queryAll((n: any) => n.type === 'Text')
    .flatMap((n: any) => n.children).filter((c: any) => typeof c === 'string').join(' ');
  expect(text).not.toContain('5 Sep 2026');
});
```

The second test is the one that matters: a logged row must not gain a redundant date, because its trip header already says the day.

- [ ] **Step 2: Run and watch them fail**

Run: `npx jest DiveRow -t 'planned'`
Expected: FAIL on the first — no date rendered today.

- [ ] **Step 3: Implement**

In the row's metadata line, when `dive.status === 'planned'`, lead with `formatDiveDate(dive.date)`. A planned dive has no number, so the slot where `#7` sits carries the word `planned` in the same muted mono.

- [ ] **Step 4: Run the suite and commit**

Run: `npm test && npm run typecheck`

```bash
git add src/components/DiveRow.tsx src/components/DiveRow.test.tsx src/screens/DivesScreen.tsx
git commit -m "Tell the diver when an upcoming dive is"
```

---

## Task 4: MOD per cylinder

**This is a live bug, not a restyle.** `src/screens/DiveDetailScreen.tsx` computes `mod(dive.tanks[0]?.o2Pct)` — the **first cylinder only**. A dive with a bottom mix and a deco gas shows one maximum operating depth and silently hides the other. MOD is a limit a diver acts on.

Every existing test fixture uses a single cylinder, which is exactly why no gate caught it.

**Files:**
- Modify: `src/screens/DiveDetailScreen.tsx`
- Test: `src/screens/DiveDetailScreen.test.tsx`

**Interfaces:**
- Consumes: `mod(o2Pct, ppO2Max?)` from `src/domain/derived.ts`.

- [ ] **Step 1: Write the failing test**

```tsx
it('shows every cylinder its own MOD, because there is no single dive MOD', async () => {
  const d = dive({
    date: '2026-06-04',
    tanks: [
      { material: 'steel', sizeL: 12, count: 2, workingBar: 232, o2Pct: 18, hePct: 45, startBar: 230, endBar: 90 },
      { material: 'alu',   sizeL: 7,  count: 1, workingBar: 200, o2Pct: 50, hePct: 0,  startBar: 200, endBar: 120 },
    ],
  });
  mockUseDives.mockReturnValue({ dives: [d], numbers: new Map([[d.id, 212]]), error: undefined });
  const text = textIn(await render(<DiveDetailScreen id={d.id} />)).join(' | ');
  // 18 % at 1.4 ppO2 -> 67.8 m; 50 % -> 18.0 m
  expect(text).toContain('67.8');
  expect(text).toContain('18.0');
});

it('does not present one cylinder’s MOD as though it were the dive’s', async () => {
  const d = dive({
    date: '2026-06-04',
    tanks: [
      { material: 'steel', sizeL: 12, count: 1, workingBar: 232, o2Pct: 18, hePct: 45, startBar: 230, endBar: 90 },
      { material: 'alu',   sizeL: 7,  count: 1, workingBar: 200, o2Pct: 50, hePct: 0,  startBar: 200, endBar: 120 },
    ],
  });
  mockUseDives.mockReturnValue({ dives: [d], numbers: new Map(), error: undefined });
  const t = await render(<DiveDetailScreen id={d.id} />);
  const mods = textIn(t).filter((s) => s.includes('67.8') || s.includes('18.0'));
  expect(mods.length).toBeGreaterThanOrEqual(2);
});
```

Verify the two expected values before relying on them: `mod(18)` and `mod(50)` at the default ppO2 max. If they differ from 67.8 and 18.0, use what the function actually returns and say so in your report — do not adjust the function.

- [ ] **Step 2: Run and watch them fail**

Run: `npx jest DiveDetailScreen -t 'MOD'`
Expected: FAIL — only the first cylinder's MOD appears.

- [ ] **Step 3: Move MOD into the per-cylinder rows**

Each cylinder already renders its own block. Give each one its own MOD row, computed from that cylinder's `o2Pct`. **Remove the single dive-level MOD entirely** — do not leave it alongside. With several gases there is no one answer, and showing a "dive MOD" next to per-cylinder ones invites the reader to believe the wrong number.

Omit a cylinder's MOD when `mod()` returns `null`, exactly as every other computed value is omitted.

- [ ] **Step 4: Run the suite**

Run: `npm test && npm run typecheck && npx expo export --platform ios`
Expected: all pass; export succeeds.

- [ ] **Step 5: Prove the single-tank case still works**

The overwhelmingly common dive has one cylinder. Confirm an existing single-tank test still shows its MOD, and that the value did not move. Report which test.

- [ ] **Step 6: Commit**

```bash
git add src/screens/DiveDetailScreen.tsx src/screens/DiveDetailScreen.test.tsx
git commit -m "Give every cylinder its own MOD, since a multi-gas dive has no single one"
```

---

## Task 5: Detail hero and computed-value markers

**Files:**
- Modify: `src/theme/styles.ts`, `src/screens/DiveDetailScreen.tsx`
- Test: `src/screens/DiveDetailScreen.test.tsx`

**Interfaces:**
- Consumes: `<DepthValue variant="hero" />` from Task 1.

- [ ] **Step 1: Write the failing test**

```tsx
it('marks a computed value so it reads differently from one the diver entered', async () => {
  const d = dive({ date: '2026-08-16', timeIn: '09:15', durationMin: 44, maxDepthM: 32.4 });
  mockUseDives.mockReturnValue({ dives: [d], numbers: new Map(), error: undefined });
  const t = await render(<DiveDetailScreen id={d.id} />);
  const labelled = (s: string) => t.root.queryAll((n: any) => n.type === 'Text')
    .find((n: any) => String(n.children[0] ?? '') === s);
  const computed = [labelled('Time out')?.props.style].flat(3).filter(Boolean);
  const entered  = [labelled('Duration')?.props.style].flat(3).filter(Boolean);
  // the computed label carries extra leading space for its marker; the entered one does not
  const pad = (st: any[]) => st.reduce((a: number, s: any) => s?.paddingLeft ?? a, 0);
  expect(pad(computed)).toBeGreaterThan(pad(entered));
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx jest DiveDetailScreen -t 'computed'`
Expected: FAIL — both labels are styled identically today.

- [ ] **Step 3: Add the hero and the marker**

```ts
detailHero:       { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14,
                    borderBottomWidth: 1, borderBottomColor: theme.border },
detailHeroSite:   { fontFamily: fonts['sans-semibold'], fontSize: 22, color: theme.fg, lineHeight: 26 },
detailHeroSub:    { fontFamily: fonts.mono, fontSize: 11.5, color: theme.fgMuted, marginTop: 3 },
detailClusterTitle:{ fontFamily: fonts.mono, fontSize: 10.5, color: theme.fgMuted,
                    textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 },
detailLabelComputed:{ paddingLeft: 13 },
// A 6 px decorative View, not a control — the 48 dp rule does not apply to it.
detailComputedMark:{ position: 'absolute', left: 0, top: 5, width: 6, height: 6,
                    borderRadius: 1, borderWidth: 1, borderColor: theme.fgMuted, opacity: 0.75 },
detailValueComputed:{ color: theme.fgMuted },
```

The hero holds the site name, a mono sub-line (`#6 · 22 Aug 2026 · Ponorka`), and `<DepthValue variant="hero" />`. Computed rows get `detailLabelComputed` plus the marker `View`, and their value takes `detailValueComputed`.

Which rows are computed: time out, surface interval, gas used, RMV, MOD. Nothing else.

- [ ] **Step 4: Run the suite and commit**

Run: `npm test && npm run typecheck && npm run lint && npx eslint .`

```bash
git add src/theme/styles.ts src/screens/DiveDetailScreen.tsx src/screens/DiveDetailScreen.test.tsx
git commit -m "Separate what the diver logged from what the app worked out"
```

---

## Task 6: Hand-ordering moves to a day strip

Today two arrow buttons sit inside every hand-orderable row, making that day roughly 1.5× taller than its neighbours, with nothing explaining why those rows and not the others.

**Files:**
- Create: `src/components/DayStrip.tsx`, `src/components/DayStrip.test.tsx`
- Modify: `src/theme/styles.ts`, `src/components/ReorderControls.tsx`, `src/screens/DivesScreen.tsx`
- Test: `src/screens/DivesScreen.test.tsx`

**Interfaces:**
- Consumes: `canReorder(dives)` and `sameDateGroups(dives)` from `src/domain/trips.ts`; `formatDiveDate`.
- Produces: `<DayStrip date={string} count={number} active={boolean} scheme={ColorScheme} onToggle={() => void} />`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('says why the day can be hand-ordered', async () => {
  const t = await render(<DayStrip date="2026-08-18" count={2} active={false} scheme="dark" onToggle={() => {}} />);
  const text = t.root.queryAll((n: any) => n.type === 'Text')
    .flatMap((n: any) => n.children).filter((c: any) => typeof c === 'string').join(' ');
  expect(text).toContain('18 Aug 2026');
  expect(text).toContain('no times');
  expect(text).toContain('Reorder');
});

it('offers to leave the mode once it is on', async () => {
  const t = await render(<DayStrip date="2026-08-18" count={2} active scheme="dark" onToggle={() => {}} />);
  const text = t.root.queryAll((n: any) => n.type === 'Text')
    .flatMap((n: any) => n.children).filter((c: any) => typeof c === 'string').join(' ');
  expect(text).toContain('Done');
  expect(text).not.toContain('Reorder');
});
```

And in `src/screens/DivesScreen.test.tsx`:

```tsx
it('shows no arrows until the day strip is switched on', async () => {
  const a = dive({ date: '2026-08-18', siteName: 'Blue Hole', maxDepthM: 12.2 });
  const b = dive({ date: '2026-08-18', siteName: 'Blue Hole', maxDepthM: 9.2 });
  (useDives as jest.Mock).mockReturnValue({ dives: [a, b], numbers: new Map(), error: undefined });
  const t = await render(<DivesScreen />);
  const text = textIn(t).join(' ');
  expect(text).toContain('Reorder');
  expect(text).toContain('12.2');   // depth still visible in the resting state
});
```

That last assertion is the one worth having: in the resting state the depth value occupies its slot, and only in reorder mode do the arrows take it.

- [ ] **Step 2: Run and watch them fail**

Run: `npx jest DayStrip`
Expected: FAIL — cannot find module `./DayStrip`.

- [ ] **Step 3: Build `DayStrip`**

A single row: on the left `18 Aug 2026 · 2 dives, no times` in muted mono; on the right a 48 dp-tall pressable reading `Reorder`, or `Done` when `active`. When active the strip takes `theme.surface` as its background so the mode is visible.

The sentence is not decoration. It states the rule from §2.5 — hand-ordering only works on a day whose dives have no entry times — so a diver who later adds a time and watches the control vanish knows why.

- [ ] **Step 4: Move the arrows into the depth slot**

In `ReorderControls`, render the arrows **in place of** `DepthValue` rather than in addition to it, so the row keeps its height. Arrows are 34 × 26 with a 48 dp touch target, monochrome, using `theme.border` and `theme.fg`.

- [ ] **Step 5: Wire the screen**

`DivesScreen` holds which day (if any) is in reorder mode — a single `string | null` of the date. Only days where `canReorder` is true get a strip. When a day is active, its rows show arrows and every other row dims to 32 % opacity.

- [ ] **Step 6: Run the suite**

Run: `npm test && npm run typecheck && npm run lint && npx eslint . && npx expo export --platform ios`
Expected: all pass.

- [ ] **Step 7: Prove the strip's condition can fail**

Give the day's dives entry times and confirm no strip renders — `canReorder` must gate it. Then remove that gate and confirm a test reddens. Restore and report both.

- [ ] **Step 8: Commit**

```bash
git add src/components/DayStrip.tsx src/components/DayStrip.test.tsx src/components/ReorderControls.tsx src/screens/DivesScreen.tsx src/screens/DivesScreen.test.tsx src/theme/styles.ts
git commit -m "Move hand-ordering behind a day strip that explains itself"
```

---

## Done when

On a simulator, with a seeded logbook:

1. Scanning the Dives list, the depth values read as a **column** — aligned decimals, band colours, clearly the largest thing in each row.
2. Trip headers read as headers: uppercase, tracked, with the date range in mono at the trailing edge.
3. A planned dive shows **when** it is, and no dive number.
4. A dive carrying only a date still renders clean — no `null`, no `NaN`, no placeholder dash.
5. A day of two untimed dives shows a strip saying `no times` and a `Reorder` action; **no arrows until it is switched on**; rows do not change height when it is.
6. Dive detail leads with the site and a hero depth in its band colour; computed values are visibly distinct from entered ones.
7. A dive with two cylinders shows **two MODs**, one per cylinder, and no dive-level MOD.
8. No profile, sparkline or chart anywhere.
9. `npm test`, `npm run typecheck`, `npm run lint`, `npx eslint .` and `npx expo export --platform ios` all clean.

Items 1 and 5 need eyes on a device — a passing test cannot tell you whether the column reads.
