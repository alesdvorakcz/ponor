# M1b · The Logbook Screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Ponor's completed data foundation into the read side of a usable dive log — a Dives list grouped into trips, a dive detail screen, hand-ordering for same-day dives, and a side-by-side layout on tablets.

**Architecture:** Every screen reads dives through one reactive hook, `useDives()`, which is built from the *same* query builder and the *same* comparator that `listDives` uses — so the ordering rules exist in exactly one place. Pure domain logic (trip grouping, search filtering, display formatting) lives in testable modules with no React in them; components stay thin. Colour comes only from `depthColor` and `makeStyles`, never a literal.

**Tech Stack:** Expo SDK 57 · React Native 0.86 · React 19.2 · `expo-router` · `expo-sqlite` + Drizzle (with `useLiveQuery`) · `StyleSheet` via `src/theme/styles.ts` · Jest + `better-sqlite3` for database round-trips.

## Global Constraints

These bind every task. Values are copied verbatim from `DESIGN.md`.

- **Colour encodes depth and nothing else.** Controls are monochrome; the primary button is inverted ink. A colour literal in a component is a defect — colours come from `makeStyles(scheme)` (§0.2 tokens) or from `depthColor(metres, scheme)` (§0.1 depth scale). No exceptions.
- **Fonts resolve through `src/theme/fonts.ts`**, never a hardcoded family string. Archivo for UI, IBM Plex Mono for all data (depths, pressures, durations, times), with `fontVariant: ['tabular-nums']` wherever digits align in a column.
- **No profile curve is ever drawn for a dive without a real sample series** (§0.4). A dive row shows the coloured depth number and no graphic. There is no sample data in v1, so **this milestone draws no profile, sparkline, or chart of any kind.**
- **SI units are stored, converted at display.** Depth in metres, pressure in bar, temperature in °C, weight in kg in the database.
- **Dive numbers are computed, never stored.** Always via `assignDiveNumbers(dives, divesBefore)`. There is no `dive_number` column and there must never be one.
- **All dive fields are nullable except `date`.** Every screen must render correctly for a dive where everything except the date is `null` — that is a legitimate, expected dive, not an error state.
- **Planned dives are excluded from numbering and pinned separately** (§2.5, §3): `status` is `'logged' | 'planned'`; planned dives appear under "Up next" and carry no dive number.
- **Same-day ordering tiers, in order:** `date` → `timeIn` → `manualOrder` → `createdAt` → `id`. Hand-ordered sorts before not-hand-ordered. **Never re-state these tiers anywhere** — call `compareDiveOrder`.
- **Reads go through the repository.** Never write a bare `db.select().from(dives)` in a screen or hook; the tombstone filter is not structurally enforced, and a tombstoned dive reaching `assignDiveNumbers` shifts every dive after it undetectably.
- Tap targets are never below **48 dp**, and the primary action sits in the bottom third of the screen (§0.5 — wet hands, one thumb).
- Czech runs 20–30 % longer than English and needs full diacritics; labels wrap to two lines rather than truncate (§0.5). No i18n framework in this milestone — English strings only — but **no fixed-width text containers** that would break when the Czech string lands in M3.
- Tests must be able to fail. This project has three separate incidents of a test asserting less than its name claimed. If you add a test, break the code under it once and confirm it goes red.
- **Nothing but real routes may live under `src/app/`.** expo-router's `require.context` sweeps that directory and treats *every* file in it as a route — including test files, which then drag `@testing-library/react-native` into the app bundle, where its `require('console')` cannot resolve and the app fails to launch. This was discovered in Task 6 the only way it can be: on a simulator, while 289 tests, both typechecks and both linters were green. Screens therefore live in `src/screens/`, with their tests beside them, and each file under `src/app/` is a thin route that re-exports one. Verify two ways, because most checks do not catch this: `.expo/types/router.d.ts` must list no `*.test` route, and **`npx expo export --platform ios` must succeed**. Do *not* trust a `curl` of the dev server's `entry.bundle` — it was measured returning byte-identical output for both the broken and the fixed tree, so it cannot fail. Metro's file-watching is also unreliable on this machine, so start a fresh process for any dev-server check rather than trusting a long-running one.

## Decisions this plan makes, and why

Two deviate from §4's stack table. Both need a `DESIGN.md` §10 entry (Task 9), the same way removing NativeWind was handled in M0.

1. **`SectionList`, not `FlashList`.** §4 names FlashList for "smooth long lists". A personal dive log tops out in the hundreds of rows, `SectionList` gives sticky trip headers for free, and it ships with React Native — where FlashList is another third-party bet on New Architecture support, which is exactly what cost this project a milestone's worth of time in M0. Revisit if a real list ever gets slow.
2. **Hand-ordering is an explicit reorder mode with move-up / move-down controls, not a drag gesture.** §2.5 promises the diver "can order them by hand"; it does not specify drag. This applies only to *untimed* same-day dives — typically two or three rows — where arrows are perfectly adequate, fully accessible, and testable without gesture simulation. `reorderDivesForDate(date, orderedIds)` takes an ordered id array either way, so a drag implementation can replace the controls later without touching the data layer.

3. **Component tests use `@testing-library/react-native`, added as an explicit devDependency in Task 5.** Today the repo has no component-testing library at all; `react-test-renderer@19.2.3` is present only *transitively* through `jest-expo`, and React 19 has deprecated it — so building six test files on it means resting the milestone on a package that is both undeclared and on its way out. Testing Library is the supported path for React Native, gives `getByText`-style queries instead of `root.findAllByType('Text')` tree-walking, and is mature rather than a preview. **If it does not install or run cleanly, stop and report it — do not silently fall back**, because that is exactly the shape of the NativeWind failure in M0, where a substitution nobody was told about cost a rewrite. `react-test-renderer` is the fallback if I approve it, not before.

A fourth decision costs nothing but must be stated: **`useDives()` is built from the same query builder and comparator as `listDives`**, rather than re-expressing either. M1a's recurring defect — three separate incidents — was one rule written in two places. Task 1 exists to make reuse the path of least resistance rather than merely possible.

---

## File structure

**Created**

| File | Responsibility |
|---|---|
| `src/db/useDives.ts` | The one reactive read. `useDives()` → live dives, sorted, with numbers. |
| `src/domain/trips.ts` | Pure: group dives into trips (consecutive days, same place); split planned from logged. |
| `src/domain/search.ts` | Pure: filter dives by a query string. |
| `src/format/display.ts` | Pure: SI value → display string (depth, temperature, duration, pressure, date, time). |
| `src/components/DepthValue.tsx` | The depth number in its band colour. The only component that calls `depthColor`. |
| `src/components/DiveRow.tsx` | One dive row: number, site, depth, time chips, rating. |
| `src/components/TripHeader.tsx` | A trip's section header. |
| `src/components/EmptyState.tsx` | The no-dives-yet state. |
| `src/app/index.tsx` | **Replaces the M0 proof screen** — a thin route re-exporting `DivesScreen`. |
| `src/screens/DivesScreen.tsx` | The Dives list screen (kept out of `src/app/` so its test can sit beside it). |
| `src/screens/DiveDetailScreen.tsx` | The dive detail screen. |
| `src/app/dive/[id].tsx` | Thin route re-exporting `DiveDetailScreen`. |
| `src/hooks/useWideLayout.ts` | Whether the viewport is wide enough for side-by-side. |

**Modified**

| File | Change |
|---|---|
| `src/db/dives.ts` | Extract `diveRowsQuery(db)` and `toDives(rows)`; `listDives` re-expressed in terms of both. |
| `src/db/settings.ts` | Extract `divesBeforeQuery(db)` so the hook can read it live. |
| `src/theme/styles.ts` | Add the styles the new components need. |
| `DESIGN.md` | §10 entries for the two deviations above (Task 9). |
| `package.json` | `@testing-library/react-native` as a devDependency (Task 5). |

---

## Task 1: One reactive read for the whole app

This is the task the milestone turns on. `listDives` returns a `Promise` and therefore cannot feed `useLiveQuery`, which needs a synchronous query builder. The obvious workaround — writing a fresh `db.select().from(dives)` in the screen and sorting it there — would put the tombstone filter and the §2.5 ordering tiers in a second place. That exact move produced the `#2, #1, #3` bug in M1a. So instead we split `listDives` into the two reusable halves it already contains, and build both the async and the reactive read from them.

**Files:**
- Modify: `src/db/dives.ts` (extract `diveRowsQuery` and `toDives`; re-express `listDives`)
- Modify: `src/db/settings.ts` (extract `divesBeforeQuery`)
- Create: `src/db/useDives.ts`
- Test: `src/db/dives.test.ts` (extend), `src/db/useDives.test.ts` (create)

**Interfaces:**
- Consumes: `liveDives` (the exported tombstone condition), `compareDiveOrder(a, b)`, `assignDiveNumbers(dives, divesBefore)`, `isDiveCount(value)`, `createTestDb()`.
- Produces:
  - `diveRowsQuery(db: Db)` — a Drizzle select builder, tombstone-filtered, **unsorted**. Awaitable *and* passable to `useLiveQuery`.
  - `toDives(rows: unknown[]): Dive[]` — maps raw rows to `Dive` and sorts them by `compareDiveOrder`, newest first.
  - `divesBeforeQuery(db: Db)` — a select builder for the `dives_before` settings row.
  - `useDives(): { dives: Dive[]; numbers: Map<string, number>; error: Error | undefined }`
  - `composeDives(rows: unknown[], divesBefore: unknown): { dives: Dive[]; numbers: Map<string, number> }` — the pure half of the hook, so it is testable without a renderer.
  - `readDivesBefore(rows: unknown[]): unknown` — pulls the raw stored value out of `divesBeforeQuery`'s rows, leaving interpretation to `isDiveCount`.

- [ ] **Step 1: Read the existing `listDives` and `toDive`**

Run: `sed -n '130,200p' src/db/dives.ts`

You need to see exactly how `listDives` builds its query, how it maps rows, and the direction it sorts in. `toDive` is currently a private helper in this file. Do not change its behaviour in this task — you are moving code, not rewriting it.

Note the sort direction carefully: `listDives` returns **newest first**, which is the reverse of `assignDiveNumbers`'s order. There is a lock-step test asserting exactly that relationship. It must still pass.

- [ ] **Step 2: Write the failing test for the extracted halves**

Add to `src/db/dives.test.ts`:

```ts
describe('diveRowsQuery / toDives', () => {
  it('together reproduce listDives exactly', async () => {
    await createDive(db, { date: '2026-08-16', timeIn: '09:00' });
    await createDive(db, { date: '2026-08-18' });
    await createDive(db, { date: '2026-08-16', timeIn: '14:00' });

    const viaHalves = toDives(await diveRowsQuery(db));
    const viaListDives = await listDives(db);

    expect(viaHalves.map((d) => d.id)).toEqual(viaListDives.map((d) => d.id));
    expect(viaHalves).toEqual(viaListDives);
  });

  it('diveRowsQuery excludes tombstoned dives', async () => {
    const kept = await createDive(db, { date: '2026-08-16' });
    const gone = await createDive(db, { date: '2026-08-17' });
    await softDeleteDive(db, gone.id);

    const ids = (await diveRowsQuery(db)).map((r) => r.id);
    expect(ids).toContain(kept.id);
    expect(ids).not.toContain(gone.id);
  });

  it('toDives sorts an already-shuffled array, so it does not depend on SQL order', async () => {
    await createDive(db, { date: '2026-08-16' });
    await createDive(db, { date: '2026-08-18' });
    await createDive(db, { date: '2026-08-17' });

    const rows = await diveRowsQuery(db);
    const shuffled = [...rows].reverse();

    expect(toDives(shuffled).map((d) => d.date)).toEqual(
      toDives(rows).map((d) => d.date),
    );
  });
});
```

The third test is the one that matters: `useLiveQuery` gives no ordering guarantee, so `toDives` must not rely on the rows arriving pre-sorted.

- [ ] **Step 3: Run it and watch it fail**

Run: `npx jest dives.test -t 'diveRowsQuery'`
Expected: FAIL — `diveRowsQuery is not defined`.

- [ ] **Step 4: Extract the two halves in `src/db/dives.ts`**

```ts
/**
 * The dive read, tombstone-filtered and deliberately UNSORTED.
 *
 * Returned as a builder rather than a Promise so it can serve both callers:
 * `listDives` awaits it, and `useDives` hands it to drizzle's `useLiveQuery`,
 * which needs a synchronous query it can re-run on every database change.
 *
 * Ordering is not applied here on purpose. SQL cannot express §2.5's tiers
 * (NULL placement differs, and `manual_order` sorts hand-ordered before
 * not-hand-ordered), so ordering belongs to `compareDiveOrder` alone. An
 * ORDER BY here would be a second, disagreeing copy of those rules — which is
 * exactly the bug that once made the logbook render #2, #1, #3.
 */
export function diveRowsQuery(db: Db) {
  return db.select().from(dives).where(liveDives);
}

/**
 * Raw rows to sorted domain dives, newest first.
 *
 * Sorts what it is given rather than trusting the caller's order: `useLiveQuery`
 * makes no ordering promise at all.
 */
export function toDives(rows: unknown[]): Dive[] {
  return rows.map(toDive).sort((a, b) => compareDiveOrder(b, a));
}
```

Then re-express `listDives` so the logic exists once:

```ts
export async function listDives(db: Db): Promise<Dive[]> {
  return toDives(await diveRowsQuery(db));
}
```

Keep `listDives`'s existing docblock, and add a line noting it is now a thin wrapper so that the async and reactive reads cannot diverge.

- [ ] **Step 5: Run the tests**

Run: `npx jest dives.test`
Expected: PASS, including the pre-existing lock-step test that pins `listDives` order as the exact reverse of `assignDiveNumbers` order. If that test fails, you changed the sort direction — `compareDiveOrder(b, a)`, not `(a, b)`.

- [ ] **Step 6: Extract the settings query**

In `src/db/settings.ts`, alongside `getDivesBefore`:

```ts
/**
 * The `dives_before` row as a builder, for `useLiveQuery`. `getDivesBefore`
 * remains the one place that interprets the stored string; this only fetches it.
 */
export function divesBeforeQuery(db: Db) {
  return db.select().from(settings).where(eq(settings.key, DIVES_BEFORE_KEY));
}
```

Use the existing key constant — do not retype the literal. If `getDivesBefore` currently builds its own query inline, re-express it in terms of `divesBeforeQuery` so there is one query, exactly as Step 4 did for dives.

- [ ] **Step 7: Write the failing test for `useDives`**

Create `src/db/useDives.test.ts`. `useLiveQuery` needs React, so test the *pure* part — the composition — rather than the hook's subscription:

```ts
import { createDive, diveRowsQuery, toDives } from './dives';
import { createTestDb, type TestDb } from './testDb';
import { setDivesBefore } from './settings';
import { composeDives } from './useDives';

let db: TestDb;
beforeEach(() => { db = createTestDb(); });

describe('composeDives', () => {
  it('numbers logged dives from the offset and leaves planned dives unnumbered', async () => {
    const first = await createDive(db, { date: '2026-08-16' });
    const second = await createDive(db, { date: '2026-08-17' });
    const planned = await createDive(db, { date: '2026-08-20', status: 'planned' });

    const { dives, numbers } = composeDives(await diveRowsQuery(db), 247);

    expect(dives.map((d) => d.id)).toEqual([planned.id, second.id, first.id]);
    expect(numbers.get(first.id)).toBe(248);
    expect(numbers.get(second.id)).toBe(249);
    expect(numbers.has(planned.id)).toBe(false);
  });

  it('treats an uninterpretable offset as no offset rather than throwing at render', async () => {
    const dive = await createDive(db, { date: '2026-08-16' });
    const { numbers } = composeDives(await diveRowsQuery(db), Number.NaN);
    expect(numbers.get(dive.id)).toBe(1);
  });
});
```

The second test encodes a real requirement: `getDivesBefore` *throws* on an uninterpretable stored value, which is right for a write path but wrong inside a render — a corrupt settings row must not turn into a white screen. The hook degrades; it does not crash.

- [ ] **Step 8: Run it and watch it fail**

Run: `npx jest useDives`
Expected: FAIL — cannot find module `./useDives`.

- [ ] **Step 9: Write `src/db/useDives.ts`**

```tsx
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { assignDiveNumbers } from '../domain/diveNumber';
import { isDiveCount } from '../domain/diveNumber';
import { type Dive } from '../domain/types';
import { db } from './client';
import { diveRowsQuery, toDives } from './dives';
import { divesBeforeQuery, readDivesBefore } from './settings';

export interface DiveListState {
  dives: Dive[];
  numbers: Map<string, number>;
  error: Error | undefined;
}

/**
 * The pure half, extracted so it can be tested without a renderer.
 */
export function composeDives(rows: unknown[], divesBefore: unknown): Omit<DiveListState, 'error'> {
  const dives = toDives(rows);
  // A corrupt settings row must not blank the screen: numbering from 0 is a
  // visibly wrong dive number, which the diver can correct in settings. A
  // thrown error inside a render is a white screen they cannot.
  const offset = isDiveCount(divesBefore) ? divesBefore : 0;
  return { dives, numbers: assignDiveNumbers(dives, offset) };
}

/**
 * The one read every screen uses.
 *
 * Deliberately offers no way to pass a different query or comparator. §2.5's
 * ordering tiers and the tombstone filter each have exactly one owner, and the
 * only reliable way to keep it that way is to make reuse easier than
 * re-deriving — advice in a comment has already failed to prevent this three
 * times in this codebase.
 */
export function useDives(): DiveListState {
  const rows = useLiveQuery(diveRowsQuery(db));
  const settingsRows = useLiveQuery(divesBeforeQuery(db));

  const { dives, numbers } = composeDives(
    rows.data ?? [],
    readDivesBefore(settingsRows.data ?? []),
  );

  return { dives, numbers, error: rows.error ?? settingsRows.error };
}
```

`readDivesBefore(rows)` is a small pure helper you add to `settings.ts`: it takes the rows `divesBeforeQuery` returns and yields the raw stored value (or `null` when the row is absent), leaving interpretation to `isDiveCount`. Export it and give it a one-line docblock saying why interpretation is not its job.

- [ ] **Step 10: Run the full suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. Baseline is 229 tests; you have added at least 5.

- [ ] **Step 11: Commit**

```bash
git add src/db/dives.ts src/db/dives.test.ts src/db/settings.ts src/db/useDives.ts src/db/useDives.test.ts
git commit -m "Give the dive read one owner that both listDives and the UI use"
```

---

## Task 2: Display formatting

Every number on screen is stored in SI and rendered in the diver's units. M1b ships metric only — the unit *setting* is M1c's — but the conversion boundary goes in now, so that adding imperial later touches one module instead of every component.

**Files:**
- Create: `src/format/display.ts`
- Test: `src/format/display.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `formatDepth(metres: number | null): string | null`, `formatTemperature(celsius: number | null): string | null`, `formatDuration(minutes: number | null): string | null`, `formatPressure(bar: number | null): string | null`, `formatDiveDate(date: string): string`, `formatTimeRange(timeIn: string | null, durationMin: number | null): string | null`.

- [ ] **Step 1: Write the failing tests**

Create `src/format/display.test.ts`:

```ts
import {
  formatDepth,
  formatDuration,
  formatDiveDate,
  formatPressure,
  formatTemperature,
  formatTimeRange,
} from './display';

describe('formatDepth', () => {
  it('shows one decimal place', () => {
    expect(formatDepth(32.44)).toBe('32.4 m');
    expect(formatDepth(18)).toBe('18.0 m');
  });
  it('returns null for an unrecorded depth rather than a zero', () => {
    expect(formatDepth(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatDepth(Number.NaN)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('renders whole minutes', () => {
    expect(formatDuration(44)).toBe('44 min');
  });
  it('renders an hour-plus dive in minutes, which is how divers log it', () => {
    expect(formatDuration(72)).toBe('72 min');
  });
  it('returns null for no duration', () => {
    expect(formatDuration(null)).toBeNull();
  });
});

describe('formatTemperature', () => {
  it('rounds to a whole degree', () => {
    expect(formatTemperature(25.6)).toBe('26 °C');
  });
  it('keeps a negative reading signed', () => {
    expect(formatTemperature(-1.2)).toBe('-1 °C');
  });
  it('returns null for no reading', () => {
    expect(formatTemperature(null)).toBeNull();
  });
});

describe('formatPressure', () => {
  it('renders whole bar', () => {
    expect(formatPressure(207.5)).toBe('208 bar');
  });
  it('returns null for no reading', () => {
    expect(formatPressure(null)).toBeNull();
  });
});

describe('formatDiveDate', () => {
  it('renders a stored calendar date without a timezone shift', () => {
    expect(formatDiveDate('2026-08-16')).toBe('16 Aug 2026');
  });
  it('renders 1 January without rolling to the previous year', () => {
    expect(formatDiveDate('2026-01-01')).toBe('1 Jan 2026');
  });
  it('hands back an uninterpretable value unchanged rather than inventing a date', () => {
    expect(formatDiveDate('not a date')).toBe('not a date');
  });
});

describe('formatTimeRange', () => {
  it('shows entry and computed exit', () => {
    expect(formatTimeRange('09:30', 44)).toBe('09:30 – 10:14');
  });
  it('shows entry alone when there is no duration', () => {
    expect(formatTimeRange('09:30', null)).toBe('09:30');
  });
  it('returns null when there is no entry time', () => {
    expect(formatTimeRange(null, 44)).toBeNull();
  });
});
```

The `formatDiveDate` timezone test is not hypothetical: `new Date('2026-01-01')` parses as UTC midnight, and in any timezone west of Greenwich `toLocaleDateString` then renders **31 Dec 2025**. Build the display date from the string's own parts, or from a `Date` constructed with explicit local components — never by handing the bare string to `new Date()`.

- [ ] **Step 2: Run and watch them fail**

Run: `npx jest display`
Expected: FAIL — cannot find module `./display`.

- [ ] **Step 3: Implement `src/format/display.ts`**

Use `timeOut(timeIn, durationMin)` from `src/domain/derived.ts` for the exit time — do not recompute it. Use `isCalendarDate` from `src/domain/datetime.ts` to decide whether a date is interpretable. Every formatter returns `null` for absent input so callers can omit the element entirely rather than render a placeholder; §1's "no form-shaming for empty fields" applies to reading as much as to writing.

Guard every numeric formatter with `Number.isFinite`, so a `NaN` that reached the database from an older client renders as nothing rather than as the string `"NaN m"`.

Use the en dash `–` in `formatTimeRange`, not a hyphen.

- [ ] **Step 4: Run the tests**

Run: `npx jest display`
Expected: PASS, all 16.

- [ ] **Step 5: Prove the timezone test can fail**

Temporarily implement `formatDiveDate` as `new Date(value).toLocaleDateString('en-GB', {...})` and run:

Run: `TZ=America/New_York npx jest display -t 'rolling to the previous year'`
Expected: FAIL, rendering `31 Dec 2025`. Then restore your correct implementation and confirm it passes under the same `TZ`.

Record both results in your report. A timezone test that passes in every timezone is not testing anything.

- [ ] **Step 6: Commit**

```bash
git add src/format/display.ts src/format/display.test.ts
git commit -m "Add display formatting, converting at the boundary rather than in components"
```

---

## Task 3: Trip grouping

§3: the Dives list is "auto-grouped into trips (consecutive days, same place)". This is pure logic over an already-sorted list, so it is fully testable without a renderer.

**Files:**
- Create: `src/domain/trips.ts`, `src/domain/diveFixture.ts`
- Test: `src/domain/trips.test.ts`

**Interfaces:**
- Consumes: `Dive` from `src/domain/types.ts`, `calendarDateToUtcMs` from `src/domain/datetime.ts`.
- Produces: `dive(over?: Partial<Dive>): Dive` (in `src/domain/diveFixture.ts` — used by Tasks 4, 5, 6, 7 and 8), `type Trip = { key: string; title: string; dateRange: string; dives: Dive[] }`, `groupIntoTrips(dives: Dive[]): Trip[]`, `splitPlanned(dives: Dive[]): { planned: Dive[]; logged: Dive[] }`. Task 8 adds `canReorder(dives: Dive[]): boolean` to this same module.

- [ ] **Step 1: Write the failing tests**

**First create the shared test fixture.** Six test files across this milestone need to build a `Dive` without a database, and a `Dive` has 39 fields — copying that shape into six files is exactly the duplication this project keeps getting bitten by, one tier down. Create `src/domain/diveFixture.ts`:

```ts
import { type Dive } from './types';

let seq = 0;

/**
 * A `Dive` with only the fields a test cares about, for tests that have no
 * database. Every other field is `null`, which is both the schema's default
 * and the case most likely to break a component (§6: everything except `date`
 * is nullable).
 *
 * Ids come from a counter, never from the fields, so two fixtures built with
 * identical arguments are still distinct. That matters more than it looks:
 * `assignDiveNumbers` deliberately SKIPS a repeated id (a duplicate would
 * otherwise consume a dive number and shift every later dive), so a fixture
 * that derived its id from the arguments would make `dive({ date: d })` twice
 * silently yield one numbered dive — a test failure with no obvious cause.
 *
 * Ids sort in creation order, matching UUIDv7's ordering property, so the
 * last tier of `compareDiveOrder` behaves here as it does in the app.
 */
export const dive = (over: Partial<Dive> = {}): Dive =>
  ({
    id: `fixture-${String(seq++).padStart(6, '0')}`,
    status: 'logged',
    date: '2026-08-16',
    timeIn: null, manualOrder: null, durationMin: null, title: null, notes: null,
    rating: null, siteId: null, siteName: null, centerId: null, centerName: null,
    entry: null, salinity: null, waterBody: null, latitude: null, longitude: null,
    maxDepthM: null, avgDepthM: null, waterTempC: null, airTempC: null,
    visibilityM: null, waves: null, current: null, surge: null, tanks: [],
    suit: null, hood: null, gloves: null, boots: null, weightsKg: null,
    buddy: null, guide: null, importSource: null, importId: null,
    createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z',
    deletedAt: null,
    ...over,
  }) as Dive;
```

Then create `src/domain/trips.test.ts`:

```ts
import { dive } from './diveFixture';
import { groupIntoTrips, splitPlanned } from './trips';

describe('splitPlanned', () => {
  it('separates planned from logged, preserving order within each', () => {
    const input = [
      dive({ date: '2026-08-20', status: 'planned' }),
      dive({ date: '2026-08-18' }),
      dive({ date: '2026-08-16' }),
    ];
    const { planned, logged } = splitPlanned(input);
    expect(planned.map((d) => d.date)).toEqual(['2026-08-20']);
    expect(logged.map((d) => d.date)).toEqual(['2026-08-18', '2026-08-16']);
  });
});

describe('groupIntoTrips', () => {
  it('groups consecutive days at the same site into one trip', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-18', siteName: 'Blue Hole' }),
      dive({ date: '2026-08-17', siteName: 'Blue Hole' }),
      dive({ date: '2026-08-16', siteName: 'Blue Hole' }),
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0]?.dives).toHaveLength(3);
    expect(trips[0]?.title).toBe('Blue Hole');
    expect(trips[0]?.dateRange).toBe('16–18 Aug 2026');
  });

  it('starts a new trip when a day is skipped', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-20', siteName: 'Blue Hole' }),
      dive({ date: '2026-08-16', siteName: 'Blue Hole' }),
    ]);
    expect(trips).toHaveLength(2);
  });

  it('starts a new trip when the place changes on consecutive days', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-17', siteName: 'Shark Reef' }),
      dive({ date: '2026-08-16', siteName: 'Blue Hole' }),
    ]);
    expect(trips).toHaveLength(2);
    expect(trips.map((t) => t.title)).toEqual(['Shark Reef', 'Blue Hole']);
  });

  it('keeps several dives on one day in one trip', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-16', siteName: 'Blue Hole', timeIn: '14:00' }),
      dive({ date: '2026-08-16', siteName: 'Blue Hole', timeIn: '09:00' }),
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0]?.dateRange).toBe('16 Aug 2026');
  });

  it('groups dives with no site name at all, rather than dropping them', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-17' }),
      dive({ date: '2026-08-16' }),
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0]?.dives).toHaveLength(2);
    expect(trips[0]?.title).toBe('Unnamed site');
  });

  it('does not merge a named site with an unnamed one', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-17', siteName: 'Blue Hole' }),
      dive({ date: '2026-08-16' }),
    ]);
    expect(trips).toHaveLength(2);
  });

  it('gives every trip a distinct key', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-20', siteName: 'Blue Hole' }),
      dive({ date: '2026-08-16', siteName: 'Blue Hole' }),
    ]);
    expect(new Set(trips.map((t) => t.key)).size).toBe(2);
  });

  it('returns nothing for no dives', () => {
    expect(groupIntoTrips([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx jest trips`
Expected: FAIL — cannot find module `./trips`.

- [ ] **Step 3: Implement `src/domain/trips.ts`**

Rules, stated exactly:

- Input is already sorted newest-first by `toDives`. Preserve that order; do not re-sort.
- Two dives belong to the same trip when their **place matches** and their dates are the **same day or one day apart**. Place is `siteName` when present, otherwise `centerName`, otherwise the sentinel for unnamed.
- Day distance comes from `calendarDateToUtcMs` — subtract and divide by 86,400,000. Do **not** subtract date strings or use local-time `Date` arithmetic; that is the same class of bug Task 2's timezone test guards.
- An unnamed place never merges with a named one, but consecutive unnamed days merge with each other.
- `key` must be unique per trip. Use the first dive's id — ids are unique and a trip always has at least one dive.
- `dateRange` is `'16 Aug 2026'` for a single day and `'16–18 Aug 2026'` for a span, with an en dash. Reuse `formatDiveDate` from Task 2 for the single-day case rather than re-implementing month names.

- [ ] **Step 4: Run the tests**

Run: `npx jest trips`
Expected: PASS, all 9.

- [ ] **Step 5: Mutation-check the day-distance rule**

Change the "one day apart" comparison to "two days apart", run `npx jest trips`, and confirm the skipped-day test goes red. Restore it. Report the result — that comparison is the whole feature, and a test suite that stays green when it changes is not testing it.

- [ ] **Step 6: Commit**

```bash
git add src/domain/trips.ts src/domain/trips.test.ts src/domain/diveFixture.ts
git commit -m "Group dives into trips by consecutive days at the same place"
```

---

## Task 4: Search

§3: the Dives list has search. Pure filtering over the in-memory list — a personal logbook is small enough that there is no reason to push this into SQL, and keeping it here means it composes with trip grouping for free.

**Files:**
- Create: `src/domain/search.ts`
- Test: `src/domain/search.test.ts`

**Interfaces:**
- Consumes: `Dive`.
- Produces: `searchDives(dives: Dive[], query: string): Dive[]`.

- [ ] **Step 1: Write the failing tests**

Create `src/domain/search.test.ts`, importing the fixture Task 3 created:

```ts
import { dive } from './diveFixture';
import { searchDives } from './search';
```


```ts
describe('searchDives', () => {
  it('returns everything for an empty or whitespace query', () => {
    const all = [dive({ siteName: 'Blue Hole' }), dive({ siteName: 'Shark Reef' })];
    expect(searchDives(all, '')).toHaveLength(2);
    expect(searchDives(all, '   ')).toHaveLength(2);
  });

  it('matches a site name case-insensitively', () => {
    const all = [dive({ siteName: 'Blue Hole' }), dive({ siteName: 'Shark Reef' })];
    expect(searchDives(all, 'blue')).toHaveLength(1);
  });

  it('matches buddy, centre, title and notes as well as site', () => {
    expect(searchDives([dive({ buddy: 'Petra' })], 'petra')).toHaveLength(1);
    expect(searchDives([dive({ centerName: 'Dive Centre' })], 'centre')).toHaveLength(1);
    expect(searchDives([dive({ title: 'Night dive' })], 'night')).toHaveLength(1);
    expect(searchDives([dive({ notes: 'saw a turtle' })], 'turtle')).toHaveLength(1);
  });

  it('matches Czech diacritics case-insensitively', () => {
    expect(searchDives([dive({ siteName: 'Šenkýřův lom' })], 'šenkýřův')).toHaveLength(1);
    expect(searchDives([dive({ siteName: 'Šenkýřův lom' })], 'ŠENKÝŘŮV')).toHaveLength(1);
  });

  it('matches a dive whose fields are all null without throwing', () => {
    expect(searchDives([dive({})], 'anything')).toHaveLength(0);
  });

  it('preserves the input order', () => {
    const all = [dive({ date: '2026-08-18', siteName: 'Reef' }), dive({ date: '2026-08-16', siteName: 'Reef' })];
    expect(searchDives(all, 'reef').map((d) => d.date)).toEqual(['2026-08-18', '2026-08-16']);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx jest search`
Expected: FAIL — cannot find module `./search`.

- [ ] **Step 3: Implement `src/domain/search.ts`**

Search these fields and no others: `siteName`, `centerName`, `buddy`, `guide`, `title`, `notes`.

Lowercase with `toLocaleLowerCase()`, not `toLowerCase()` — the app ships in Czech, and the two differ for some locales. Skip `null` fields rather than coercing them, so `null` never stringifies to `"null"` and matches a search for "ull".

Trim the query; an empty or whitespace-only query returns the input array unchanged.

- [ ] **Step 4: Run the tests**

Run: `npx jest search`
Expected: PASS, all 6.

- [ ] **Step 5: Commit**

```bash
git add src/domain/search.ts src/domain/search.test.ts
git commit -m "Add dive search across the text fields a diver would recall"
```

---

## Task 5: The depth value and the dive row

The first components. `DepthValue` is the only place in the app allowed to call `depthColor` — the depth scale is the app's single expressive element and it needs one owner, same as everything else on this branch.

**Files:**
- Create: `src/components/DepthValue.tsx`, `src/components/DiveRow.tsx`
- Modify: `src/theme/styles.ts`
- Test: `src/components/DiveRow.test.tsx`

**Interfaces:**
- Consumes: `depthColor(metres, scheme)`, `makeStyles(scheme)`, `formatDepth`, `formatDuration`, `formatTimeRange`, `Dive`.
- Produces: `<DepthValue metres={number | null} scheme={ColorScheme} />`, `<DiveRow dive={Dive} number={number | undefined} scheme={ColorScheme} onPress={(id: string) => void} />`.

- [ ] **Step 0: Add the component-testing library and smoke-test it**

```bash
npx expo install --dev @testing-library/react-native
```

Then write a throwaway test that renders `<Text>hello</Text>` and asserts it is found, run it, and delete it. Do this **before** writing any component so that a broken install surfaces in two minutes rather than after six test files are written against it.

If the install fails, or the smoke test cannot pass, **stop and report it** rather than substituting another library. `react-test-renderer@19.2.3` is present transitively and would work, but React 19 has deprecated it — swapping to it is a decision for the plan-holder, not a workaround to apply quietly.

Run: `npm test && npm run typecheck`
Expected: still 100 % green, with one more devDependency in `package.json` and `package-lock.json`.

- [ ] **Step 1: Add the styles**

In `src/theme/styles.ts`'s `build(scheme)`, add the named styles the row needs: a row container, the dive-number label (mono, muted), the site name (Archivo, `fg`), a chip for time and duration (mono, `fg-muted`), and a rating display. Take every colour from `theme` and every family from `fonts` — that is what this module exists for.

Give the row container `minHeight: 48` — §0.5's tap-target floor is a functional requirement, not a suggestion.

- [ ] **Step 2: Write the failing tests**

Create `src/components/DiveRow.test.tsx`. Assert on what is rendered, not on a snapshot — a snapshot of a component nobody has seen yet just records whatever it happens to do, and passes forever afterwards including when it is wrong.

The tests below are written against `@testing-library/react-native`'s API. Adapt the query calls to whatever the installed version provides if they differ; keep the assertions identical.

```tsx
import { create } from 'react-test-renderer';
import { DiveRow } from './DiveRow';
import { depthColor } from '../theme/depth';

import { dive } from '../domain/diveFixture';

const textIn = (tree) =>
  tree.root.findAllByType('Text').flatMap((n) => n.children).filter((c) => typeof c === 'string');

it('shows the dive number, site and depth', () => {
  const t = create(<DiveRow dive={dive({ siteName: 'Blue Hole', maxDepthM: 32.4 })} number={248} scheme="dark" onPress={() => {}} />);
  const text = textIn(t).join(' ');
  expect(text).toContain('248');
  expect(text).toContain('Blue Hole');
  expect(text).toContain('32.4 m');
});

it('colours the depth by its band, not by the theme', () => {
  const t = create(<DiveRow dive={dive({ maxDepthM: 32.4 })} number={1} scheme="dark" onPress={() => {}} />);
  const depthNode = t.root.findAllByType('Text').find((n) => String(n.children[0]).includes('32.4'));
  expect(depthNode.props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ color: depthColor(32.4, 'dark') })]),
  );
});

it('renders a dive with nothing but a date, without placeholders or a crash', () => {
  const t = create(<DiveRow dive={dive({ date: '2026-08-16' })} number={1} scheme="dark" onPress={() => {}} />);
  const text = textIn(t).join(' ');
  expect(text).not.toContain('null');
  expect(text).not.toContain('NaN');
  expect(text).not.toContain('undefined');
});

it('shows no dive number for a planned dive', () => {
  const t = create(<DiveRow dive={dive({ status: 'planned' })} number={undefined} scheme="dark" onPress={() => {}} />);
  expect(textIn(t).join(' ')).not.toMatch(/#\d/);
});

it('draws no graphic for a dive, because no dive has a sample series', () => {
  const t = create(<DiveRow dive={dive({ maxDepthM: 32.4 })} number={1} scheme="dark" onPress={() => {}} />);
  expect(t.root.findAllByType('Svg')).toHaveLength(0);
});

it('passes the dive id to onPress', () => {
  const onPress = jest.fn();
  const d = dive({ id: 'abc' });
  const t = create(<DiveRow dive={d} number={1} scheme="dark" onPress={onPress} />);
  t.root.findByType('Pressable').props.onPress();
  expect(onPress).toHaveBeenCalledWith('abc');
});
```

The third test is the important one. A dive with only a date is legitimate and common (§6: everything except `date` is nullable), and rendering `null m` for it is the single most likely bug in this task.

The fifth encodes §0.4 as a test rather than a hope.

- [ ] **Step 3: Run and watch them fail**

Run: `npx jest DiveRow`
Expected: FAIL — cannot find module `./DiveRow`.

- [ ] **Step 4: Implement `DepthValue.tsx`**

```tsx
/**
 * A depth in its band's colour — the app's one piece of expressive colour (§0.1).
 *
 * The only caller of `depthColor` in the app. Colour is depth's alone; a second
 * component reaching for the depth scale to tint something else would break the
 * rule that makes the scale readable at a glance.
 *
 * Renders nothing at all for an unrecorded depth. A placeholder dash would
 * occupy the slot where a real value goes and read, at a glance down a list, as
 * a value the diver failed to enter — which §1 explicitly refuses to do.
 */
```

Render a `Text` with the mono font and `fontVariant: ['tabular-nums']`, taking its colour from `depthColor(metres, scheme)` and its content from `formatDepth(metres)`. Return `null` when `formatDepth` does.

- [ ] **Step 5: Implement `DiveRow.tsx`**

Layout per §3: `number, site, depth · time chips, rating`.

- The number renders as `#248`, in mono, muted. Omit entirely when `number` is `undefined` (planned dives).
- The site is `siteName ?? centerName ?? 'Unnamed site'`, in Archivo, `fg`, allowed to wrap to two lines (`numberOfLines={2}`) — never truncated to one, per §0.5.
- The depth is `<DepthValue />`.
- Time chips come from `formatTimeRange` and `formatDuration`; omit each when `null`.
- Rating renders as filled/empty marks only when `rating` is non-null.
- Wrap in a `Pressable` calling `onPress(dive.id)`, with `minHeight: 48`.
- Wrap the export in `React.memo` — `makeStyles` is already memoised at module scope specifically so that row memoisation works, so honour that.

Do not draw a sparkline, a bar, or any graphic. §0.4 is absolute and there is no sample data in v1.

- [ ] **Step 6: Run the tests**

Run: `npx jest DiveRow`
Expected: PASS, all 6.

- [ ] **Step 7: Verify the colour rule holds across the whole app**

Run: `grep -rnE "#[0-9a-fA-F]{3,8}\b" src/components src/app`
Expected: no output. Any hit is a colour literal in a component, which is a defect under the global constraints. `src/theme/` is allowed to contain them; nothing else is.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/components/DepthValue.tsx src/components/DiveRow.tsx src/components/DiveRow.test.tsx src/theme/styles.ts
git commit -m "Add the dive row and the depth value that carries the app's only colour"
```

---

## Task 6: The Dives screen

Replaces the M0 proof screen. This is the app's front door.

**Files:**
- Modify: `src/app/index.tsx` (full replacement)
- Create: `src/components/TripHeader.tsx`, `src/components/EmptyState.tsx`
- Modify: `src/theme/styles.ts`
- Test: `src/app/index.test.tsx`

**Interfaces:**
- Consumes: `useDives()`, `groupIntoTrips`, `splitPlanned`, `searchDives`, `DiveRow`, `makeStyles`, `resolveScheme`.
- Produces: the route `/`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/index.test.tsx`. Mock `useDives` so the screen is tested without a database — the hook has its own tests from Task 1:

```tsx
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
import { useDives } from '../db/useDives';
import DivesScreen from './index';

it('shows the empty state when there are no dives', () => {
  (useDives as jest.Mock).mockReturnValue({ dives: [], numbers: new Map(), error: undefined });
  const t = create(<DivesScreen />);
  expect(textIn(t).join(' ')).toContain('Log your first dive');
});

it('pins planned dives above logged ones under "Up next"', () => {
  (useDives as jest.Mock).mockReturnValue({
    dives: [dive({ id: 'p', date: '2026-09-01', status: 'planned' }), dive({ id: 'l', date: '2026-08-16' })],
    numbers: new Map([['l', 12]]),
    error: undefined,
  });
  const text = textIn(create(<DivesScreen />)).join(' ');
  expect(text).toContain('Up next');
  expect(text.indexOf('Up next')).toBeLessThan(text.indexOf('12'));
});

it('surfaces a read error instead of rendering an empty logbook', () => {
  (useDives as jest.Mock).mockReturnValue({ dives: [], numbers: new Map(), error: new Error('disk') });
  const text = textIn(create(<DivesScreen />)).join(' ');
  expect(text).not.toContain('Log your first dive');
  expect(text.toLowerCase()).toContain("couldn't");
});
```

The third test matters: an empty list and a failed read look identical to a diver, and telling someone their logbook is empty when the database failed to open is the worst possible lie for this app to tell.

- [ ] **Step 2: Run and watch them fail**

Run: `npx jest app/index`
Expected: FAIL.

- [ ] **Step 3: Implement `TripHeader.tsx` and `EmptyState.tsx`**

`TripHeader` shows the trip title and its date range, styled from `makeStyles`. `EmptyState` shows a short line and the primary action — "Log your first dive" — as the inverted-ink primary button (`action` / `action-fg` tokens), in the bottom third of the screen per §0.5.

- [ ] **Step 4: Implement the screen**

```tsx
export default function DivesScreen() {
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const { dives, numbers, error } = useDives();
  const [query, setQuery] = useState('');

  if (error) return <ReadError styles={styles} />;

  const matching = searchDives(dives, query);
  const { planned, logged } = splitPlanned(matching);
  const sections = [
    ...(planned.length ? [{ key: 'up-next', title: 'Up next', dateRange: '', dives: planned }] : []),
    ...groupIntoTrips(logged),
  ];
  ...
}
```

Render a `SectionList` with `stickySectionHeadersEnabled`, `TripHeader` as `renderSectionHeader`, and `DiveRow` as `renderItem` — passing `numbers.get(dive.id)`, which is `undefined` for planned dives exactly as `DiveRow` expects.

Search is a `TextInput` above the list. Show the empty state only when `dives.length === 0`; when the list is non-empty but the *query* matches nothing, say so instead — those are different situations and a diver who mistyped a search should not be told they have no dives.

The "+" primary action sits in the bottom third (§3: "big + button as the app's main gesture"). It navigates to the dive form, which does not exist until M1c — wire it to a route that does not yet exist and leave it inert this milestone; do not build a stub form.

- [ ] **Step 5: Run the tests and the full suite**

Run: `npx jest app/index && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/index.tsx src/app/index.test.tsx src/components/TripHeader.tsx src/components/EmptyState.tsx src/theme/styles.ts
git commit -m "Replace the proof screen with the Dives list"
```

---

## Task 7: Dive detail

**Files:**
- Create: `src/screens/DiveDetailScreen.tsx` (the screen itself)
- Create: `src/app/dive/[id].tsx` (a thin route that re-exports the screen — nothing else)
- Modify: `src/theme/styles.ts`
- Test: `src/screens/DiveDetailScreen.test.tsx`

**The test must not live under `src/app/`.** expo-router sweeps that directory as routes and would pull the testing library into the app bundle, breaking the launch — see the Global Constraints. Task 6 hit exactly this and the fix was to extract the screen; follow the same shape here from the start.

**Interfaces:**
- Consumes: `useDives()`, `formatDepth`/`formatTemperature`/`formatDuration`/`formatPressure`/`formatDiveDate`/`formatTimeRange`, `rmv`, `mod`, `gasUsedLitres`, `usedBar`, `surfaceIntervalMin`, `DepthValue`.
- Produces: the route `/dive/[id]`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows the computed values a diver cannot see in the raw fields', () => {
  // a dive with tanks, depth and duration set
  const text = renderDetail(diveWithGas).join(' ');
  expect(text).toContain('RMV');
  expect(text).toContain('MOD');
});

it('omits a computed value entirely when its inputs are missing', () => {
  const text = renderDetail(dive({ date: '2026-08-16' })).join(' ');
  expect(text).not.toContain('RMV');
  expect(text).not.toContain('NaN');
});

it('shows nothing but the date for a dive with only a date', () => {
  const text = renderDetail(dive({ date: '2026-08-16' })).join(' ');
  expect(text).toContain('16 Aug 2026');
  expect(text).not.toContain('null');
});

it('draws no profile chart, because no dive carries a sample series', () => {
  const t = renderDetailTree(diveWithGas);
  expect(t.root.findAllByType('Svg')).toHaveLength(0);
});

it('says the dive is gone rather than crashing when the id is unknown', () => {
  const text = renderDetailFor('no-such-id').join(' ');
  expect(text.toLowerCase()).toContain('not found');
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx jest detail`
Expected: FAIL.

- [ ] **Step 3: Implement the screen**

Read the id from `useLocalSearchParams()`, find the dive in `useDives()`'s list — do **not** add a second read path; the hook already holds every live dive and a separate `getDive` here would be a second query to keep in step.

Show, in the §3 clusters: date and time, site and centre, depth and duration, conditions, gas and cylinders, equipment and people, notes. Omit any field that is `null`, and omit a whole cluster when every field in it is `null` — §1's "no form-shaming".

Show the computed values from `src/domain/derived.ts`: used pressure, gas used, RMV, MOD, time out, surface interval. Each is omitted when its function returns `null`. **Never render a computed value the domain refused to produce** — those functions return `null` precisely because the inputs were absent or contradictory, and inventing a display value would defeat the safety reasoning behind them.

Draw no profile chart (§0.4).

- [ ] **Step 4: Run the tests**

Run: `npx jest detail && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/DiveDetailScreen.tsx src/screens/DiveDetailScreen.test.tsx src/app/dive src/theme/styles.ts
git commit -m "Add the dive detail screen"
```

---

## Task 8: Hand-ordering same-day dives

§2.5 promises the diver can order same-day dives by hand when times are missing. `reorderDivesForDate` exists and returns `{ applied, effectiveOrder, overriddenIds }`.

**Read this before you start:** the function reports **success while changing nothing** when the day's dives have entry times, because `timeIn` outranks `manualOrder` in §2.5's tiers. That is correct per the frozen spec. It means a UI that offers reordering on a timed day gives the diver a control that appears to work and silently does not. **Offer the control only where §2.5 lets it do something**, and use `applied` to confirm.

Note also: `effectiveOrder` runs in the **opposite direction** to the list — `listDives`/`toDives` are newest-first, `effectiveOrder` is chronological. Reverse it before comparing against what is on screen. Getting this wrong silently inverts the day.

**Files:**
- Modify: `src/app/index.tsx`
- Create: `src/components/ReorderControls.tsx`
- Test: `src/app/reorder.test.tsx`

**Interfaces:**
- Consumes: `reorderDivesForDate(db, date, orderedIds)`, `ReorderOutcome`.
- Produces: `<ReorderControls dives={Dive[]} onReorder={(ids: string[]) => void} />`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('offers reordering for a day of untimed dives', () => {
  expect(canReorder([dive({ date: '2026-08-16' }), dive({ date: '2026-08-16' })])).toBe(true);
});

it('does not offer reordering when the day has entry times, because it could not take effect', () => {
  expect(canReorder([
    dive({ date: '2026-08-16', timeIn: '09:00' }),
    dive({ date: '2026-08-16', timeIn: '14:00' }),
  ])).toBe(false);
});

it('does not offer reordering for a single dive', () => {
  expect(canReorder([dive({ date: '2026-08-16' })])).toBe(false);
});

it('moving a dive down sends the ids in chronological order, not list order', async () => {
  const reorder = jest.fn().mockResolvedValue({ applied: true, effectiveOrder: [], overriddenIds: [] });
  // list order is newest-first: [b, a]; moving b down means chronological [b, a]
  await moveDown(['b', 'a'], 0, reorder);
  expect(reorder).toHaveBeenCalledWith(expect.anything(), '2026-08-16', ['a', 'b'].reverse());
});

it('surfaces a reorder that did not take effect rather than silently springing back', async () => {
  const reorder = jest.fn().mockResolvedValue({ applied: false, effectiveOrder: ['a', 'b'], overriddenIds: ['b'] });
  const result = await applyReorder(['b', 'a'], reorder);
  expect(result.message).toBeTruthy();
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx jest reorder`
Expected: FAIL.

- [ ] **Step 3: Implement `canReorder` and the controls**

`canReorder(dives)` returns true only when a day has **two or more dives and none of them has a `timeIn`**. Put it in `src/domain/trips.ts` next to the grouping it belongs with, and unit-test it there too.

`ReorderControls` shows move-up / move-down buttons per row (48 dp minimum), reordering a local array and calling `onReorder` with the resulting ids **in chronological order** — reverse the newest-first list order before sending.

Handle the `applied: false` case: show a short message rather than letting the list spring back with no explanation. It should not be reachable given `canReorder`, which is exactly why it needs handling — an unreachable branch that silently does nothing is how a later change to `canReorder` becomes a mystery bug.

- [ ] **Step 4: Run the tests**

Run: `npx jest reorder && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ReorderControls.tsx src/app/index.tsx src/app/reorder.test.tsx src/domain/trips.ts src/domain/trips.test.ts
git commit -m "Let a diver hand-order same-day dives, where the tiers allow it"
```

---

## Task 9: Tablet layout, and the two decision-log entries

§3: "list + detail side by side" on wide screens, no separate codebase.

**Files:**
- Create: `src/hooks/useWideLayout.ts`
- Modify: `src/app/index.tsx`
- Modify: `DESIGN.md` (§10)
- Test: `src/hooks/useWideLayout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('is narrow on a phone and wide on a tablet', () => {
  expect(isWide(390)).toBe(false);   // iPhone 17 Pro
  expect(isWide(744)).toBe(false);   // iPad mini portrait — still one column
  expect(isWide(1024)).toBe(true);   // iPad landscape
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx jest useWideLayout`
Expected: FAIL.

- [ ] **Step 3: Implement**

`isWide(width: number)` is the pure predicate — threshold 900 — and `useWideLayout()` wraps it over `useWindowDimensions()`. Keep the predicate pure and separately tested; the hook is then trivial and needs no test of its own.

In `index.tsx`, when wide, render the list at a fixed column width with the detail beside it for the selected dive; when narrow, keep the current navigation. Do not duplicate the detail markup — import the same component the route renders.

- [ ] **Step 4: Add the §10 entries**

Add to `DESIGN.md` §10, in the established voice — the decision, then the alternative it beat, then why:

- **`SectionList` rather than FlashList** (revises §4's UI row): sticky trip headers come free, a personal logbook is hundreds of rows not thousands, and it ships with React Native rather than being another third-party bet on New Architecture support — which is what cost M0 a rewrite. Revisit if a real list ever gets slow.
- **Hand-ordering is move-up / move-down, not drag** (implements §2.5): it applies only to untimed same-day dives, typically two or three rows; arrows are accessible and testable without gesture simulation; and `reorderDivesForDate(date, orderedIds)` takes an ordered id array either way, so a drag implementation can replace it later without touching the data layer.

Also update §4's UI row so the table and the decision log agree.

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck && npm run lint && npx eslint .`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useWideLayout.ts src/hooks/useWideLayout.test.ts src/app/index.tsx DESIGN.md
git commit -m "Lay the logbook out side by side on tablets, and record M1b's two deviations"
```

---

## Done when

M1b is complete when, on a simulator:

1. The Dives tab lists dives grouped into trips, newest first, with sticky headers.
2. A planned dive appears under "Up next" above the logged dives and shows **no** dive number.
3. Every dive row shows its number, site, and a depth in its band colour — and a dive carrying only a date renders cleanly, with no `null`, `NaN`, or placeholder dash.
4. Searching narrows the list; clearing it restores the list.
5. Tapping a row opens detail; detail shows the computed values and omits every one whose inputs are absent.
6. A day of two untimed dives offers reordering, the order survives an app restart, and a day of timed dives offers no reordering control at all.
7. Rotating an iPad to landscape puts list and detail side by side.
8. **No profile curve, sparkline, or chart appears anywhere** (§0.4).
9. `npm test`, `npm run typecheck`, `npm run lint` and `npx eslint .` are all clean, and CI is green.

Item 6's restart check is the one a passing Jest suite cannot make for you — run it on the simulator by hand, the same way M1a's persistence check was run.
