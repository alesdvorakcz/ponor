# M1a · Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tested, offline-first data layer for dives — schema, migrations, a typed repository, and every value the app computes rather than stores — with no UI.

**Architecture:** SQLite on the device via `expo-sqlite`, with Drizzle as the typed schema and query layer. The schema is driver-agnostic SQLite, so the repository is exercised in CI against `better-sqlite3` running the *same* schema and the *same* migration files — real round-trips, no device needed. Everything the app derives rather than stores (dive number, RMV, MOD, surface interval, used pressure, time out) lives in `src/domain/` as pure functions with no database or React dependency, so it is trivially testable and reusable by the list, the form and the future stats screen alike.

**Tech Stack:** `expo-sqlite@~57.0.2` · `drizzle-orm@^0.45.2` · `drizzle-kit@^0.31.10` (dev) · `better-sqlite3` (dev, tests only) · `uuidv7@^1.2.1` · TypeScript · Jest.

## Global Constraints

Copied from `DESIGN.md`; these bind every task.

- **SI units are stored**, converted only at display. Depths in metres, pressure in bar, temperature in °C, weight in kg, volume in litres.
- **IDs are client-generated UUIDv7**, so a dive created offline never needs re-mapping on sync.
- **Every column is nullable except `id`, `user_id` and `date`.** A diver logging a shore dive with no computer must be able to save it.
- **All synced tables carry `updated_at` and `deleted_at`** (a tombstone; rows are never hard-deleted).
- **Dive numbers are computed, never stored** — chronological position plus the `dives_before` offset. There is no `dive_number` column and must not be one.
- **Tanks are one JSON array column** on the dive row, first entry = main cylinder. Not a child table: they are never queried independently, and whole-row sync stays trivial.
- **Also computed, never stored:** used pressure, RMV across all tanks, MOD when diving nitrox, time out, surface interval.
- **Planned dives (`status = 'planned'`) are excluded from dive numbering and from stats** until completed.
- **Colour encodes depth and nothing else** — irrelevant to this milestone, which has no UI, but do not add any.
- Zero suppression comments (`@ts-expect-error`, `@ts-ignore`, `eslint-disable`) anywhere in the tree.
- No colour literals or font-family strings in `src/app/**` — ESLint enforces this.

**Deliberately not in M1a:** any screen, any React component, unit conversion for display, autocomplete, sites and centers tables, sync, certifications. Those are M1b–M1e and M2.

---

### Task 1: Domain types and UUIDv7 ids

**Files:**
- Create: `src/domain/types.ts`, `src/domain/ids.ts`, `src/domain/ids.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `types.ts` exports `DiveStatus`, `Entry`, `Salinity`, `WaterBody`, `TankMaterial`, `Suit`, `Tank`, `Dive`
  - `ids.ts` exports `newId(): string`

- [ ] **Step 1: Install the id library**

```bash
npm install uuidv7
```

- [ ] **Step 2: Write the failing test**

Create `src/domain/ids.test.ts`:

```ts
import { newId } from './ids';

describe('newId', () => {
  it('returns a canonical UUID string', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('returns version 7, so ids sort by creation time', () => {
    expect(newId()[14]).toBe('7');
  });

  it('never repeats', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
  });

  it('sorts lexicographically in creation order', () => {
    const a = newId();
    const b = newId();
    expect([b, a].sort()).toEqual([a, b]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
npm test -- src/domain/ids.test.ts
```

Expected: FAIL — `Cannot find module './ids'`.

- [ ] **Step 4: Write the implementation**

Create `src/domain/ids.ts`:

```ts
import { uuidv7 } from 'uuidv7';

/**
 * A new client-generated UUIDv7. Version 7 embeds a millisecond timestamp in the
 * high bits, so ids sort by creation order — which is why a dive created offline
 * never needs re-mapping when it eventually syncs.
 */
export function newId(): string {
  return uuidv7();
}
```

- [ ] **Step 5: Run it to verify it passes**

```bash
npm test -- src/domain/ids.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 6: Write the domain types**

Create `src/domain/types.ts`:

```ts
export type DiveStatus = 'logged' | 'planned';
export type Entry = 'shore' | 'boat' | 'other';
export type Salinity = 'salt' | 'fresh' | 'brackish';
export type WaterBody = 'ocean' | 'lake' | 'river' | 'quarry' | 'cave' | 'pool';
export type TankMaterial = 'steel' | 'alu';
export type Suit = 'none' | 'shorty' | 'wet' | 'semidry' | 'dry';

/**
 * One cylinder. Stored as an entry in the dive row's `tanks` JSON array, first
 * entry = the main cylinder. Every field is nullable: a diver may know the size
 * and pressures but not the working pressure, or nothing but the gas mix.
 */
export interface Tank {
  material: TankMaterial | null;
  /** Water capacity in litres. */
  sizeL: number | null;
  /** 2 for a twinset, 1 otherwise. */
  count: number | null;
  workingBar: number | null;
  /** 21 is air. */
  o2Pct: number | null;
  hePct: number | null;
  startBar: number | null;
  endBar: number | null;
}

/**
 * A dive as the app sees it. Mirrors the `dives` table; SI units throughout.
 * Everything is nullable except id, date and status — see DESIGN.md §6.
 *
 * Note what is absent: no dive number, no used pressure, no RMV, no MOD, no
 * surface interval. Those are computed from this data, never stored.
 */
export interface Dive {
  id: string;
  status: DiveStatus;
  /** ISO date, `YYYY-MM-DD`. Local calendar date of the dive, not a timestamp. */
  date: string;
  /** Local wall-clock `HH:MM`, or null when unknown. */
  timeIn: string | null;
  durationMin: number | null;
  title: string | null;
  notes: string | null;
  rating: number | null;

  siteId: string | null;
  siteName: string | null;
  centerId: string | null;
  centerName: string | null;
  entry: Entry | null;
  salinity: Salinity | null;
  waterBody: WaterBody | null;
  latitude: number | null;
  longitude: number | null;

  maxDepthM: number | null;
  avgDepthM: number | null;
  waterTempC: number | null;
  airTempC: number | null;
  visibilityM: number | null;
  waves: number | null;
  current: number | null;
  surge: number | null;

  tanks: Tank[];

  suit: Suit | null;
  hood: boolean | null;
  gloves: boolean | null;
  boots: boolean | null;
  weightsKg: number | null;
  buddy: string | null;
  guide: string | null;

  importSource: string | null;
  importId: string | null;

  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
```

- [ ] **Step 7: Verify and commit**

```bash
npm test && npm run typecheck && npm run lint
```

Expected: all exit 0.

```bash
git add src/domain/ids.ts src/domain/ids.test.ts src/domain/types.ts package.json package-lock.json
git commit -m "Add domain types and UUIDv7 id generation"
```

---

### Task 2: Derived values — the numbers the app computes

**Files:**
- Create: `src/domain/derived.ts`, `src/domain/derived.test.ts`

**Interfaces:**
- Consumes: `Tank`, `Dive` from `src/domain/types.ts`.
- Produces:
  - `usedBar(tank: Tank): number | null`
  - `gasUsedLitres(tanks: Tank[]): number | null`
  - `rmv(dive: Pick<Dive, 'tanks' | 'avgDepthM' | 'durationMin'>): number | null`
  - `mod(o2Pct: number | null | undefined, ppO2Max?: number): number | null`
  - `timeOut(timeIn: string | null, durationMin: number | null): string | null`
  - `surfaceIntervalMin(previous: Pick<Dive,'date'|'timeIn'|'durationMin'>, next: Pick<Dive,'date'|'timeIn'>): number | null`

Every one returns `null` rather than throwing when its inputs are absent. That is deliberate: `DESIGN.md` §6 makes every dive field nullable except the date, so a half-filled dive is normal, not exceptional, and these are called during render.

- [ ] **Step 1: Write the failing test**

Create `src/domain/derived.test.ts`:

```ts
import type { Tank } from './types';
import { gasUsedLitres, mod, rmv, surfaceIntervalMin, timeOut, usedBar } from './derived';

const tank = (over: Partial<Tank> = {}): Tank => ({
  material: 'steel', sizeL: 12, count: 1, workingBar: 232,
  o2Pct: 21, hePct: null, startBar: 200, endBar: 50, ...over,
});

describe('usedBar', () => {
  it('is start minus end', () => {
    expect(usedBar(tank())).toBe(150);
  });

  it('is null when either pressure is missing', () => {
    expect(usedBar(tank({ startBar: null }))).toBeNull();
    expect(usedBar(tank({ endBar: null }))).toBeNull();
  });

  it('is null when the cylinder ends fuller than it started', () => {
    // A transcription slip, not a real dive. Better no number than a negative one.
    expect(usedBar(tank({ startBar: 50, endBar: 200 }))).toBeNull();
  });
});

describe('gasUsedLitres', () => {
  it('multiplies used pressure by water capacity', () => {
    expect(gasUsedLitres([tank()])).toBe(1800); // 150 bar x 12 l
  });

  it('counts both cylinders of a twinset', () => {
    expect(gasUsedLitres([tank({ count: 2 })])).toBe(3600);
  });

  it('sums across independent cylinders', () => {
    expect(gasUsedLitres([tank(), tank({ sizeL: 7, startBar: 200, endBar: 100 })])).toBe(2500);
  });

  it('treats a missing count as one cylinder', () => {
    expect(gasUsedLitres([tank({ count: null })])).toBe(1800);
  });

  it('ignores cylinders it cannot compute, rather than discarding the dive', () => {
    expect(gasUsedLitres([tank(), tank({ startBar: null })])).toBe(1800);
  });

  it('is null when no cylinder yields a figure', () => {
    expect(gasUsedLitres([tank({ sizeL: null })])).toBeNull();
    expect(gasUsedLitres([])).toBeNull();
  });
});

describe('rmv', () => {
  it('converts consumption to surface-equivalent litres per minute', () => {
    // 1800 l used, 20 m average => 3 ata, 45 min => 1800 / 3 / 45 = 13.33
    expect(rmv({ tanks: [tank()], avgDepthM: 20, durationMin: 45 })).toBeCloseTo(13.33, 2);
  });

  it('gives a higher figure for the same gas used deeper', () => {
    const shallow = rmv({ tanks: [tank()], avgDepthM: 10, durationMin: 45 })!;
    const deep = rmv({ tanks: [tank()], avgDepthM: 30, durationMin: 45 })!;
    expect(shallow).toBeGreaterThan(deep);
  });

  it('is null when any input it needs is missing', () => {
    expect(rmv({ tanks: [tank()], avgDepthM: null, durationMin: 45 })).toBeNull();
    expect(rmv({ tanks: [tank()], avgDepthM: 20, durationMin: null })).toBeNull();
    expect(rmv({ tanks: [tank({ sizeL: null })], avgDepthM: 20, durationMin: 45 })).toBeNull();
  });

  it('is null for a zero-length dive rather than dividing by zero', () => {
    expect(rmv({ tanks: [tank()], avgDepthM: 20, durationMin: 0 })).toBeNull();
  });
});

describe('mod', () => {
  it('gives the familiar figure for air at 1.4 bar', () => {
    expect(mod(21)).toBeCloseTo(56.67, 2);
  });

  it('gives a shallower limit for a richer mix', () => {
    expect(mod(32)).toBeCloseTo(33.75, 2);
    expect(mod(36)).toBeCloseTo(28.89, 2);
  });

  it('accepts a different oxygen partial pressure', () => {
    expect(mod(32, 1.6)).toBeCloseTo(40, 2);
  });

  it('is null without a mix', () => {
    expect(mod(null)).toBeNull();
    expect(mod(undefined)).toBeNull();
  });

  it('is null for a nonsensical mix rather than returning a hazardous number', () => {
    expect(mod(0)).toBeNull();
    expect(mod(-5)).toBeNull();
    expect(mod(101)).toBeNull();
  });
});

describe('timeOut', () => {
  it('adds the duration to the entry time', () => {
    expect(timeOut('08:12', 44)).toBe('08:56');
  });

  it('rolls past the hour', () => {
    expect(timeOut('08:45', 30)).toBe('09:15');
  });

  it('wraps past midnight', () => {
    expect(timeOut('23:50', 30)).toBe('00:20');
  });

  it('is null without both parts', () => {
    expect(timeOut(null, 44)).toBeNull();
    expect(timeOut('08:12', null)).toBeNull();
  });
});

describe('surfaceIntervalMin', () => {
  it('measures from the previous dive surfacing to the next entry', () => {
    const previous = { date: '2026-08-16', timeIn: '08:12', durationMin: 44 };
    const next = { date: '2026-08-16', timeIn: '10:38' };
    expect(surfaceIntervalMin(previous, next)).toBe(102); // out at 08:56
  });

  it('spans midnight between consecutive days', () => {
    const previous = { date: '2026-08-16', timeIn: '23:00', durationMin: 30 };
    const next = { date: '2026-08-17', timeIn: '00:30' };
    expect(surfaceIntervalMin(previous, next)).toBe(60);
  });

  it('is null when either dive lacks a time', () => {
    expect(surfaceIntervalMin({ date: '2026-08-16', timeIn: null, durationMin: 44 }, { date: '2026-08-16', timeIn: '10:38' })).toBeNull();
    expect(surfaceIntervalMin({ date: '2026-08-16', timeIn: '08:12', durationMin: 44 }, { date: '2026-08-16', timeIn: null })).toBeNull();
  });

  it('is null when the next dive precedes the previous one surfacing', () => {
    const previous = { date: '2026-08-16', timeIn: '10:00', durationMin: 60 };
    const next = { date: '2026-08-16', timeIn: '10:30' };
    expect(surfaceIntervalMin(previous, next)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm test -- src/domain/derived.test.ts
```

Expected: FAIL — `Cannot find module './derived'`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/derived.ts`:

```ts
import type { Dive, Tank } from './types';

/** Metres of sea water per bar of ambient pressure. */
const METRES_PER_BAR = 10;
/** The conservative oxygen partial-pressure ceiling most agencies teach. */
const DEFAULT_PPO2_MAX = 1.4;

function isNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Pressure consumed from one cylinder, or null if it cannot be known. */
export function usedBar(tank: Tank): number | null {
  if (!isNumber(tank.startBar) || !isNumber(tank.endBar)) return null;
  const used = tank.startBar - tank.endBar;
  return used >= 0 ? used : null;
}

/**
 * Free gas consumed across every cylinder, in litres at surface pressure.
 * Cylinders that cannot be computed are skipped rather than voiding the dive —
 * a diver who recorded pressures for the main cylinder but not the stage should
 * still get a figure.
 */
export function gasUsedLitres(tanks: Tank[]): number | null {
  let total = 0;
  let counted = 0;
  for (const tank of tanks) {
    const used = usedBar(tank);
    if (used === null || !isNumber(tank.sizeL)) continue;
    const count = isNumber(tank.count) && tank.count > 0 ? tank.count : 1;
    total += used * tank.sizeL * count;
    counted += 1;
  }
  return counted > 0 ? total : null;
}

/**
 * Respiratory minute volume: how much gas the diver would breathe per minute at
 * the surface. Dividing by the average ambient pressure is what makes dives at
 * different depths comparable.
 */
export function rmv(
  dive: Pick<Dive, 'tanks' | 'avgDepthM' | 'durationMin'>,
): number | null {
  const litres = gasUsedLitres(dive.tanks);
  if (litres === null) return null;
  if (!isNumber(dive.avgDepthM) || dive.avgDepthM < 0) return null;
  if (!isNumber(dive.durationMin) || dive.durationMin <= 0) return null;
  const ata = dive.avgDepthM / METRES_PER_BAR + 1;
  return litres / ata / dive.durationMin;
}

/**
 * Maximum operating depth for a mix, in metres — the depth at which oxygen
 * partial pressure reaches the ceiling. Returns null for a mix that is not a
 * real one, rather than a number a diver might act on.
 */
export function mod(
  o2Pct: number | null | undefined,
  ppO2Max: number = DEFAULT_PPO2_MAX,
): number | null {
  if (!isNumber(o2Pct) || o2Pct <= 0 || o2Pct > 100) return null;
  return (ppO2Max / (o2Pct / 100) - 1) * METRES_PER_BAR;
}

function toMinutes(hhmm: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function toClock(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Wall-clock time the diver surfaced, wrapping past midnight. */
export function timeOut(timeIn: string | null, durationMin: number | null): string | null {
  if (timeIn === null || !isNumber(durationMin)) return null;
  const start = toMinutes(timeIn);
  if (start === null) return null;
  return toClock(start + durationMin);
}

/**
 * Minutes on the surface between one dive surfacing and the next descending.
 * Null when either time is unknown, or when the pair is out of order — an
 * interval that ran backwards means the data is wrong, not that it was zero.
 */
export function surfaceIntervalMin(
  previous: Pick<Dive, 'date' | 'timeIn' | 'durationMin'>,
  next: Pick<Dive, 'date' | 'timeIn'>,
): number | null {
  if (previous.timeIn === null || next.timeIn === null) return null;
  const previousStart = toMinutes(previous.timeIn);
  const nextStart = toMinutes(next.timeIn);
  if (previousStart === null || nextStart === null) return null;

  const previousDay = Date.parse(`${previous.date}T00:00:00Z`);
  const nextDay = Date.parse(`${next.date}T00:00:00Z`);
  if (Number.isNaN(previousDay) || Number.isNaN(nextDay)) return null;
  const dayOffsetMin = (nextDay - previousDay) / 60000;

  const surfaced = previousStart + (isNumber(previous.durationMin) ? previous.durationMin : 0);
  const interval = dayOffsetMin + nextStart - surfaced;
  return interval >= 0 ? interval : null;
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npm test -- src/domain/derived.test.ts
```

Expected: PASS — 27 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm test && npm run typecheck && npm run lint
```

```bash
git add src/domain/derived.ts src/domain/derived.test.ts
git commit -m "Add derived dive values: used gas, RMV, MOD, time out, surface interval"
```

---

### Task 3: Dive numbering

**Files:**
- Create: `src/domain/diveNumber.ts`, `src/domain/diveNumber.test.ts`

**Interfaces:**
- Consumes: `Dive` from `src/domain/types.ts`.
- Produces: `assignDiveNumbers(dives: DiveOrdering[], divesBefore: number): Map<string, number>` and the exported type `DiveOrdering = Pick<Dive, 'id' | 'status' | 'date' | 'timeIn' | 'createdAt'>`.

This is the mechanism `DESIGN.md` §2.5 describes: numbers are position, not data. Backfilling an old dive renumbers everything after it for free, on every device, with no sync writes.

- [ ] **Step 1: Write the failing test**

Create `src/domain/diveNumber.test.ts`:

```ts
import { assignDiveNumbers, type DiveOrdering } from './diveNumber';

const dive = (over: Partial<DiveOrdering> & { id: string }): DiveOrdering => ({
  status: 'logged', date: '2026-08-16', timeIn: null,
  createdAt: '2026-08-16T10:00:00.000Z', ...over,
});

describe('assignDiveNumbers', () => {
  it('numbers dives chronologically from one', () => {
    const numbers = assignDiveNumbers(
      [dive({ id: 'b', date: '2026-08-17' }), dive({ id: 'a', date: '2026-08-16' })],
      0,
    );
    expect(numbers.get('a')).toBe(1);
    expect(numbers.get('b')).toBe(2);
  });

  it('offsets by the dives logged before Ponor', () => {
    const numbers = assignDiveNumbers([dive({ id: 'a' })], 247);
    expect(numbers.get('a')).toBe(248);
  });

  it('orders same-day dives by entry time', () => {
    const numbers = assignDiveNumbers(
      [dive({ id: 'second', timeIn: '14:30' }), dive({ id: 'first', timeIn: '09:15' })],
      0,
    );
    expect(numbers.get('first')).toBe(1);
    expect(numbers.get('second')).toBe(2);
  });

  it('falls back to creation order when times are missing', () => {
    const numbers = assignDiveNumbers(
      [
        dive({ id: 'later', createdAt: '2026-08-16T12:00:00.000Z' }),
        dive({ id: 'earlier', createdAt: '2026-08-16T09:00:00.000Z' }),
      ],
      0,
    );
    expect(numbers.get('earlier')).toBe(1);
    expect(numbers.get('later')).toBe(2);
  });

  it('puts a dive with a time before one without, on the same day', () => {
    const numbers = assignDiveNumbers(
      [dive({ id: 'untimed' }), dive({ id: 'timed', timeIn: '09:15' })],
      0,
    );
    expect(numbers.get('timed')).toBe(1);
    expect(numbers.get('untimed')).toBe(2);
  });

  it('excludes planned dives entirely', () => {
    const numbers = assignDiveNumbers(
      [dive({ id: 'planned', status: 'planned', date: '2026-08-18' }), dive({ id: 'logged' })],
      0,
    );
    expect(numbers.get('logged')).toBe(1);
    expect(numbers.has('planned')).toBe(false);
  });

  it('renumbers everything after a backfilled dive', () => {
    const existing = [dive({ id: 'a', date: '2026-08-16' }), dive({ id: 'b', date: '2026-08-17' })];
    const before = assignDiveNumbers(existing, 0);
    expect(before.get('b')).toBe(2);

    const after = assignDiveNumbers([...existing, dive({ id: 'old', date: '2020-01-01' })], 0);
    expect(after.get('old')).toBe(1);
    expect(after.get('a')).toBe(2);
    expect(after.get('b')).toBe(3);
  });

  it('returns an empty map for no dives', () => {
    expect(assignDiveNumbers([], 10).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm test -- src/domain/diveNumber.test.ts
```

Expected: FAIL — `Cannot find module './diveNumber'`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/diveNumber.ts`:

```ts
import type { Dive } from './types';

/** The only fields numbering depends on. */
export type DiveOrdering = Pick<Dive, 'id' | 'status' | 'date' | 'timeIn' | 'createdAt'>;

/**
 * Dive numbers are position, not data — see DESIGN.md §2.5. Nothing is stored,
 * so backfilling an old dive renumbers every later dive for free, identically on
 * every device, with no sync writes at all.
 *
 * Ordering is date, then entry time, then creation order. A dive with a recorded
 * time sorts before one without on the same day, on the assumption that the
 * untimed dive is the one being added after the fact.
 *
 * Planned dives are absent from the result: they have no number until completed.
 */
export function assignDiveNumbers(
  dives: DiveOrdering[],
  divesBefore: number,
): Map<string, number> {
  const logged = dives
    .filter((d) => d.status === 'logged')
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.timeIn !== b.timeIn) {
        if (a.timeIn === null) return 1;
        if (b.timeIn === null) return -1;
        return a.timeIn < b.timeIn ? -1 : 1;
      }
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });

  const numbers = new Map<string, number>();
  logged.forEach((d, index) => numbers.set(d.id, divesBefore + index + 1));
  return numbers;
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npm test -- src/domain/diveNumber.test.ts
```

Expected: PASS — 8 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm test && npm run typecheck && npm run lint
```

```bash
git add src/domain/diveNumber.ts src/domain/diveNumber.test.ts
git commit -m "Compute dive numbers from chronology and the dives_before offset"
```

---

### Task 4: Drizzle schema and migrations

**Files:**
- Create: `src/db/schema.ts`, `drizzle.config.ts`, `src/db/migrations/` (generated)
- Modify: `package.json`, `metro.config.js`

**Interfaces:**
- Consumes: the enums from `src/domain/types.ts`.
- Produces: the `dives`, `gearPresets` and `settings` Drizzle tables, and a generated SQL migration under `src/db/migrations/`.

- [ ] **Step 1: Install Drizzle and expo-sqlite**

```bash
npx expo install expo-sqlite
npm install drizzle-orm
npm install --save-dev drizzle-kit
```

Record the resolved versions with `npm ls drizzle-orm drizzle-kit expo-sqlite`.

- [ ] **Step 2: Write the schema**

Create `src/db/schema.ts`:

```ts
import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Suit, Tank } from '../domain/types';

/**
 * One row per dive. SI units throughout (DESIGN.md §6): metres, bar, °C, kg, litres.
 *
 * Everything is nullable except id, status, date and the timestamps — a diver who
 * surfaces knowing only that they dived today must still be able to save.
 *
 * There is deliberately no dive_number column: numbers are computed from
 * chronology plus the dives_before offset (§2.5), so backfilling renumbers for
 * free with no sync churn. Do not add one.
 */
export const dives = sqliteTable('dives', {
  id: text('id').primaryKey(),
  status: text('status').$type<'logged' | 'planned'>().notNull().default('logged'),

  date: text('date').notNull(),
  timeIn: text('time_in'),
  durationMin: integer('duration_min'),
  title: text('title'),
  notes: text('notes'),
  rating: integer('rating'),

  siteId: text('site_id'),
  siteName: text('site_name'),
  centerId: text('center_id'),
  centerName: text('center_name'),
  entry: text('entry').$type<'shore' | 'boat' | 'other'>(),
  salinity: text('salinity').$type<'salt' | 'fresh' | 'brackish'>(),
  waterBody: text('water_body').$type<'ocean' | 'lake' | 'river' | 'quarry' | 'cave' | 'pool'>(),
  /**
   * DESIGN.md §6 calls this one `location` (a PostGIS point on the server). SQLite
   * has no point type, so it is two columns here; the Postgres side composes them
   * into a point in M2. Update §6 to say so rather than letting the two drift.
   */
  latitude: real('latitude'),
  longitude: real('longitude'),

  maxDepthM: real('max_depth_m'),
  avgDepthM: real('avg_depth_m'),
  waterTempC: real('water_temp_c'),
  airTempC: real('air_temp_c'),
  visibilityM: real('visibility_m'),
  waves: integer('waves'),
  current: integer('current'),
  surge: integer('surge'),

  /** JSON array of Tank, first entry = main cylinder. See DESIGN.md §6. */
  tanks: text('tanks', { mode: 'json' }).$type<Tank[]>().notNull().default(sql`'[]'`),

  suit: text('suit').$type<Suit>(),
  hood: integer('hood', { mode: 'boolean' }),
  gloves: integer('gloves', { mode: 'boolean' }),
  boots: integer('boots', { mode: 'boolean' }),
  weightsKg: real('weights_kg'),
  buddy: text('buddy'),
  guide: text('guide'),

  /** Reserved so a future dive-computer import can dedupe safely (§6). */
  importSource: text('import_source'),
  importId: text('import_id'),

  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  /** Tombstone. Rows are never hard-deleted, so sync can propagate the deletion. */
  deletedAt: text('deleted_at'),
});

/** Named equipment sets — "cold water", "tropical" — applied to a dive in one tap (§2.1). */
export const gearPresets = sqliteTable('gear_presets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tanks: text('tanks', { mode: 'json' }).$type<Tank[]>().notNull().default(sql`'[]'`),
  suit: text('suit').$type<Suit>(),
  hood: integer('hood', { mode: 'boolean' }),
  gloves: integer('gloves', { mode: 'boolean' }),
  boots: integer('boots', { mode: 'boolean' }),
  weightsKg: real('weights_kg'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

/** Local-only key/value settings: units, locale, hidden field groups, dives_before. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
```

- [ ] **Step 3: Configure drizzle-kit**

Create `drizzle.config.ts`:

```ts
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  driver: 'expo',
} satisfies Config;
```

Add to `package.json` `"scripts"`: `"db:generate": "drizzle-kit generate"`.

- [ ] **Step 4: Generate the first migration**

```bash
npm run db:generate
```

Expected: a `0000_*.sql` file and a `meta/` directory under `src/db/migrations/`. Confirm the SQL contains `CREATE TABLE \`dives\`` and **no** `dive_number` column:

```bash
ls src/db/migrations/
grep -c "dive_number" src/db/migrations/*.sql || echo "0 — correct, numbers are computed"
```

- [ ] **Step 5: Teach Metro to bundle the .sql migrations**

Migrations are `.sql` files that must ship inside the JS bundle. In `metro.config.js`, after `getDefaultConfig` and before the export, add:

```js
// Drizzle ships migrations as .sql files that must be bundled, not read from disk —
// there is no filesystem to read them from on a device.
config.resolver.sourceExts.push('sql');
```

- [ ] **Step 6: Verify and commit**

```bash
npm test && npm run typecheck && npm run lint
```

```bash
git add src/db/schema.ts src/db/migrations drizzle.config.ts metro.config.js package.json package-lock.json
git commit -m "Add the dives schema, gear presets and settings, with the first migration"
```

---

### Task 5: The dive repository

**Files:**
- Create: `src/db/dives.ts`, `src/db/dives.test.ts`, `src/db/testDb.ts`
- Modify: `package.json`, `tsconfig.json`, `tsconfig.test.json`

**`testDb.ts` must be moved out of the app TypeScript program before it will compile.** `tsconfig.json` covers `**/*.ts` with `types: []` (no ambient Node types) and excludes only `**/*.test.ts` — so `testDb.ts` would land in the app program, where importing `better-sqlite3` fails. Add `"src/db/testDb.ts"` to `tsconfig.json`'s `exclude` array and to `tsconfig.test.json`'s `include` array. Do this in Step 1, before writing the file, or Step 4's typecheck will fail for a reason unrelated to the code.

**Interfaces:**
- Consumes: `dives` table from `src/db/schema.ts`; `Dive`, `Tank` from `src/domain/types.ts`; `newId` from `src/domain/ids.ts`.
- Produces, all taking a Drizzle database as their first argument so they work against either driver:
  - `createDive(db, input: NewDiveInput): Promise<Dive>`
  - `getDive(db, id: string): Promise<Dive | null>`
  - `listDives(db): Promise<Dive[]>`
  - `updateDive(db, id: string, patch: Partial<NewDiveInput>): Promise<Dive>`
  - `softDeleteDive(db, id: string): Promise<void>`
  - the exported type `NewDiveInput = Partial<Omit<Dive, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>> & Pick<Dive, 'date'>`

**On testing against a different driver:** `expo-sqlite` is a native module and cannot run under Jest. The repository therefore takes its database as an argument, and the tests pass it a `better-sqlite3` instance running the **same schema and the same generated migrations**. The SQL dialect is identical, so this exercises real inserts, reads and JSON round-trips rather than mocks. It is not a substitute for running on a device — Task 6 does that — but it makes the query layer testable in CI.

- [ ] **Step 1: Install the test driver**

```bash
npm install --save-dev better-sqlite3 @types/better-sqlite3
```

If `better-sqlite3` fails to build on this machine, stop and report it rather than mocking the database — a mocked repository test is worse than none.

- [ ] **Step 2: Write the test-database helper**

Create `src/db/testDb.ts`:

```ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

/**
 * An in-memory database with the real migrations applied.
 *
 * expo-sqlite is a native module and cannot run under Jest, so the repository
 * takes its db as an argument and tests supply this instead. Same schema, same
 * migration files, same SQL dialect — real round-trips, no mocks.
 */
export function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './src/db/migrations' });
  return db;
}

export type TestDb = ReturnType<typeof createTestDb>;
```

- [ ] **Step 3: Write the failing test**

Create `src/db/dives.test.ts`:

```ts
import { createDive, getDive, listDives, softDeleteDive, updateDive } from './dives';
import { createTestDb, type TestDb } from './testDb';

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});

describe('createDive', () => {
  it('saves a dive with only a date — the one required field', async () => {
    const dive = await createDive(db, { date: '2026-08-16' });
    expect(dive.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(dive.date).toBe('2026-08-16');
    expect(dive.status).toBe('logged');
    expect(dive.maxDepthM).toBeNull();
    expect(dive.tanks).toEqual([]);
  });

  it('round-trips the tanks JSON array', async () => {
    const tanks = [
      { material: 'steel' as const, sizeL: 12, count: 1, workingBar: 232, o2Pct: 21, hePct: null, startBar: 200, endBar: 50 },
    ];
    const created = await createDive(db, { date: '2026-08-16', tanks });
    const read = await getDive(db, created.id);
    expect(read?.tanks).toEqual(tanks);
  });

  it('round-trips booleans as booleans, not integers', async () => {
    const created = await createDive(db, { date: '2026-08-16', hood: true, gloves: false });
    const read = await getDive(db, created.id);
    expect(read?.hood).toBe(true);
    expect(read?.gloves).toBe(false);
  });

  it('stamps created and updated times', async () => {
    const dive = await createDive(db, { date: '2026-08-16' });
    expect(dive.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(dive.updatedAt).toBe(dive.createdAt);
    expect(dive.deletedAt).toBeNull();
  });
});

describe('getDive', () => {
  it('returns null for an unknown id', async () => {
    expect(await getDive(db, 'nope')).toBeNull();
  });
});

describe('listDives', () => {
  it('returns every dive, newest date first', async () => {
    await createDive(db, { date: '2026-08-16' });
    await createDive(db, { date: '2026-08-18' });
    await createDive(db, { date: '2026-08-17' });
    expect((await listDives(db)).map((d) => d.date)).toEqual(['2026-08-18', '2026-08-17', '2026-08-16']);
  });

  it('includes planned dives — the list pins them on top itself', async () => {
    await createDive(db, { date: '2026-08-16' });
    await createDive(db, { date: '2026-08-20', status: 'planned' });
    expect(await listDives(db)).toHaveLength(2);
  });

  it('is empty on a fresh database', async () => {
    expect(await listDives(db)).toEqual([]);
  });
});

describe('updateDive', () => {
  it('changes only what it is given', async () => {
    const created = await createDive(db, { date: '2026-08-16', siteName: 'Elphinstone Reef' });
    const updated = await updateDive(db, created.id, { maxDepthM: 32.4 });
    expect(updated.maxDepthM).toBe(32.4);
    expect(updated.siteName).toBe('Elphinstone Reef');
  });

  it('moves updatedAt forward but leaves createdAt alone', async () => {
    const created = await createDive(db, { date: '2026-08-16' });
    const updated = await updateDive(db, created.id, { notes: 'Two oceanic whitetips.' });
    expect(updated.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));
  });

  it('can clear a field back to null', async () => {
    const created = await createDive(db, { date: '2026-08-16', buddy: 'Petr' });
    const updated = await updateDive(db, created.id, { buddy: null });
    expect(updated.buddy).toBeNull();
  });

  it('rejects an unknown id rather than silently doing nothing', async () => {
    await expect(updateDive(db, 'nope', { notes: 'x' })).rejects.toThrow(/not found/i);
  });
});

describe('softDeleteDive', () => {
  it('tombstones rather than removing, so sync can propagate the deletion', async () => {
    const created = await createDive(db, { date: '2026-08-16' });
    await softDeleteDive(db, created.id);
    expect(await getDive(db, created.id)).toBeNull();
    expect(await listDives(db)).toEqual([]);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

```bash
npm test -- src/db/dives.test.ts
```

Expected: FAIL — `Cannot find module './dives'`.

- [ ] **Step 5: Write the repository**

Create `src/db/dives.ts`:

```ts
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { newId } from '../domain/ids';
import type { Dive } from '../domain/types';
import { dives } from './schema';

/** Anything a caller may set. Only the date is required — DESIGN.md §6. */
export type NewDiveInput = Partial<Omit<Dive, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>> &
  Pick<Dive, 'date'>;

/**
 * Any Drizzle SQLite database. Left generic rather than tied to one driver so the
 * app can pass expo-sqlite while tests pass better-sqlite3 — see testDb.ts. The
 * schema generics are unconstrained because the two drivers instantiate them
 * differently; the table references below are still fully typed.
 */
type Db = BaseSQLiteDatabase<'sync' | 'async', unknown, Record<string, never>>;

const now = () => new Date().toISOString();

function toDive(row: typeof dives.$inferSelect): Dive {
  return { ...row, tanks: row.tanks ?? [] } as Dive;
}

export async function createDive(db: Db, input: NewDiveInput): Promise<Dive> {
  const timestamp = now();
  const row = {
    ...input,
    id: newId(),
    status: input.status ?? 'logged',
    tanks: input.tanks ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  await db.insert(dives).values(row);
  return toDive(row as typeof dives.$inferSelect);
}

export async function getDive(db: Db, id: string): Promise<Dive | null> {
  const rows = await db
    .select()
    .from(dives)
    .where(and(eq(dives.id, id), isNull(dives.deletedAt)))
    .limit(1);
  return rows.length > 0 ? toDive(rows[0]) : null;
}

/** Every live dive, newest date first. Planned dives are included; the list pins them itself. */
export async function listDives(db: Db): Promise<Dive[]> {
  const rows = await db
    .select()
    .from(dives)
    .where(isNull(dives.deletedAt))
    .orderBy(desc(dives.date), desc(dives.timeIn), desc(dives.createdAt));
  return rows.map(toDive);
}

export async function updateDive(
  db: Db,
  id: string,
  patch: Partial<NewDiveInput>,
): Promise<Dive> {
  const existing = await getDive(db, id);
  if (existing === null) throw new Error(`updateDive: dive not found: ${id}`);
  await db
    .update(dives)
    .set({ ...patch, updatedAt: now() })
    .where(eq(dives.id, id));
  const updated = await getDive(db, id);
  if (updated === null) throw new Error(`updateDive: dive vanished during update: ${id}`);
  return updated;
}

/**
 * Tombstones the dive. Rows are never hard-deleted (DESIGN.md §6) so the deletion
 * can propagate to other devices when sync arrives in M2.
 */
export async function softDeleteDive(db: Db, id: string): Promise<void> {
  await db.update(dives).set({ deletedAt: now(), updatedAt: now() }).where(eq(dives.id, id));
}
```

- [ ] **Step 6: Run it to verify it passes**

```bash
npm test -- src/db/dives.test.ts
```

Expected: PASS — 13 tests.

If `BaseSQLiteDatabase` with those generics does not accept both drivers, **do not reach for `any` or a suppression** — the tree has zero suppression comments and that rule holds here. Report what the compiler actually says; widening the generics or accepting the driver union explicitly are both fine, inventing an escape hatch is not.

- [ ] **Step 7: Verify and commit**

```bash
npm test && npm run typecheck && npm run lint
```

```bash
git add src/db/dives.ts src/db/dives.test.ts src/db/testDb.ts package.json package-lock.json
git commit -m "Add the dive repository with round-trip tests against a real SQLite database"
```

---

### Task 6: Wire the database into the app and prove it persists

**Files:**
- Create: `src/db/client.ts`
- Modify: `src/app/_layout.tsx`, `src/app/index.tsx`

**Interfaces:**
- Consumes: `schema`, migrations, and the repository from Tasks 4–5.
- Produces: `db` (the app's live Drizzle instance) and `useMigrations()` from `src/db/client.ts`.

Everything before this ran in Jest. This task proves the same code works on a real device against `expo-sqlite`, which is the only thing that can.

- [ ] **Step 1: Write the client**

Create `src/db/client.ts`:

```ts
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { useMigrations as useDrizzleMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { openDatabaseSync } from 'expo-sqlite';
import migrations from './migrations/migrations';
import * as schema from './schema';

const sqlite = openDatabaseSync('ponor.db', { enableChangeListener: true });

/** The app's database. Tests never touch this — they build their own (see testDb.ts). */
export const db = drizzle(sqlite, { schema });

/** Applies any pending migrations. Returns `{ success, error }`. */
export function useMigrations() {
  return useDrizzleMigrations(db, migrations);
}
```

- [ ] **Step 2: Run migrations at startup**

In `src/app/_layout.tsx`, call `useMigrations()` and hold rendering until it resolves. Add the import and the guard, keeping everything else as it is:

```tsx
import { useMigrations } from '../db/client';
```

and inside `RootLayout`, before the return:

```tsx
  const { success, error } = useMigrations();
  if (error) throw error;
  if (!success) return null;
```

Throwing on a migration error is deliberate: a half-migrated database is worse than a visible crash, and there is no recovery a user could perform.

- [ ] **Step 3: Prove persistence on the screen**

The M0 proof screen exists to show that things work. Extend it: in `src/app/index.tsx`, count the dives in the database and render the count, with a button that inserts one.

Add the imports:

```tsx
import { useEffect, useState } from 'react';
import { createDive, listDives } from '../db/dives';
import { db } from '../db/client';
```

Add state and a handler inside the component:

```tsx
  const [count, setCount] = useState<number | null>(null);
  const refresh = () => listDives(db).then((d) => setCount(d.length));
  useEffect(() => { refresh(); }, []);
```

Change the existing "Log a dive" `Pressable` to insert a dive and refresh, and put the count in its label — replace the button's `onPress` and its `Text` child:

```tsx
      <Pressable
        style={styles.action}
        onPress={() => createDive(db, { date: new Date().toISOString().slice(0, 10) }).then(refresh)}
      >
        <Text style={styles.actionLabel}>
          {count === null ? 'Log a dive' : `Log a dive · ${count} saved`}
        </Text>
      </Pressable>
```

Keep every existing style; add none. This is scaffolding that M1b replaces with the real list.

- [ ] **Step 4: Verify in Jest, typecheck and lint**

```bash
npm test && npm run typecheck && npm run lint
```

Expected: all exit 0, with the same test count as Task 5.

- [ ] **Step 5: Prove it on the simulator**

Watchman refuses to start under an automated shell's reduced priority, so Metro is configured not to use it; `pod install` on this machine needs a locale. Build and run:

```bash
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios
```

Then, **in the running app**:
1. Tap "Log a dive" three times. The label must read `Log a dive · 3 saved`.
2. **Fully quit and relaunch the app.** The label must still read `3 saved`.

Step 2 is the whole point of this task. A count that resets on relaunch means the data lived in memory and nothing was persisted, which is exactly the failure a passing Jest suite would not catch. Capture a screenshot of the count after relaunch.

- [ ] **Step 6: Commit**

```bash
git add src/db/client.ts src/app/_layout.tsx src/app/index.tsx
git commit -m "Open the SQLite database, migrate at startup, and prove dives persist"
```

---

## M1a done when

- A dive can be created, read, updated and tombstoned through the repository, with the tanks JSON and booleans surviving a round-trip.
- Dive numbers, RMV, MOD, used gas, time out and surface interval are computed correctly, and return null rather than throwing when their inputs are absent.
- The migration runs on a real device and dives survive a full app restart.
- `npm test`, `npm run typecheck` and `npm run lint` are green, and CI passes on a clean checkout.

## Deliberately not in M1a

No screens beyond the throwaway counter, no unit conversion for display, no autocomplete, no sites or centers tables, no sync, no certifications. Those are M1b–M1e and M2.
