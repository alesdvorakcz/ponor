# Dive Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ponor can import dives exported from the Suunto app, including their depth profiles, with a seam that makes the next dive-computer format a new file rather than a rewrite.

**Architecture:** A `DiveImporter` interface turns file bytes into normalised dives; a registry picks the importer by sniffing content, never by file extension. One shared writer dedupes on `(import_source, import_id)` and writes each dive in its own transaction. Depth profiles land in a new `dive_samples` table — one row per dive carrying the whole series as JSON — registered as the sixth synced table through the existing whole-row LWW protocol.

**Tech Stack:** TypeScript · Drizzle + `expo-sqlite` · `expo-document-picker` (new) · Supabase Postgres · Jest + `@testing-library/react-native` · i18next

**Spec:** [`docs/superpowers/specs/2026-09-08-dive-import-design.md`](../specs/2026-09-08-dive-import-design.md)

## Global Constraints

- **Read the spec first.** Every mapping rule below has a *reason* recorded there; the reasons are the point.
- **SI units are stored**, converted only at display. Pressures in bar, depths in metres, sizes in litres, temperatures in °C.
- **All dive fields are nullable except `date`.** Never write a zero or an empty string where the source has nothing.
- **Client-generated UUIDv7 ids.** `dive_samples.id` is the dive's own id — not a fresh one.
- **Synced tables carry** `created_at`, `updated_at`, `deleted_at` and a device-only `dirty` flag.
- **Both languages, always.** Every new user-facing string goes in `src/i18n/en.ts` *and* `src/i18n/cs.ts`. In Czech, avoid `Ponor` where the sentence also means a dive — see M3n.
- **`StyleSheet` from `src/theme/tokens`.** No colour literals anywhere; `unexpectedGraphics` tests enforce it.
- **TDD.** Write the failing test, watch it fail for the right reason, then implement. Tests are colocated (`foo.ts` + `foo.test.ts`).
- **Green before commit:** `npm test`, `npm run typecheck`, `npm run lint`.
- **Never** convert a dive's timestamp through UTC. `domain/datetime.ts` owns both string forms.

---

### Task 1: The `dive_samples` table and its local reads and writes

**Files:**
- Modify: `src/db/schema.ts` (add table beside `certifications`, ~line 275)
- Create: `src/db/migrations/0003_*.sql` (generated)
- Create: `src/db/diveSamples.ts`
- Test: `src/db/diveSamples.test.ts`

**Interfaces:**
- Consumes: `jsonArray<T>()`, `dirtyFlag()`, `stampLocalWrite()` (`src/db/dirty.ts`), `Db` (`src/db/client.ts`)
- Produces: `DiveSample` (tuple type), `diveSamples` (table), `putDiveSamples(db, diveId, series): Promise<void>`, `getDiveSamples(db, diveId): Promise<DiveSample[] | null>`, `tombstoneDiveSamples(db, diveId): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// src/db/diveSamples.test.ts
import { testDb } from './testDb';
import { getDiveSamples, putDiveSamples } from './diveSamples';

it('stores a series and reads back exactly what it was given', async () => {
  const db = await testDb();
  const series: DiveSample[] = [
    [0.57, 1.27, 27.7, 188.9],
    [10.31, 2.96, 27.7, 188.0],
  ];
  await putDiveSamples(db, 'dive-1', series);
  expect(await getDiveSamples(db, 'dive-1')).toEqual(series);
});

it('answers null for a dive with no series, which is most dives', async () => {
  const db = await testDb();
  expect(await getDiveSamples(db, 'never-imported')).toBeNull();
});

it('replaces a series rather than appending, so re-import cannot double it', async () => {
  const db = await testDb();
  await putDiveSamples(db, 'dive-1', [[0, 1, null, null]]);
  await putDiveSamples(db, 'dive-1', [[0, 2, null, null], [10, 3, null, null]]);
  const back = await getDiveSamples(db, 'dive-1');
  expect(back).toHaveLength(2);
  expect(back?.[0]?.[1]).toBe(2);
});

// A tombstoned series reads as absent — the row survives for sync, but nothing may draw it.
it('reads a tombstoned series as absent rather than as data', async () => {
  const db = await testDb();
  await putDiveSamples(db, 'dive-1', [[0, 1, null, null]]);
  await tombstoneDiveSamples(db, 'dive-1');
  expect(await getDiveSamples(db, 'dive-1')).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/db/diveSamples.test.ts`
Expected: FAIL — `Cannot find module './diveSamples'`

- [ ] **Step 3: Add the table to `src/db/schema.ts`**

Place it immediately after the `certifications` table. `jsonArray<T>()` already exists in this file (~line 47) and emits `text`; reuse it rather than writing a second decoder.

```ts
/**
 * A dive's depth profile — **one row per dive, not one per sample** (§6, and the import spec).
 *
 * §10 settled this shape once already, for `tanks`: "a JSON array on the dive row, not a child
 * table: never queried independently; keeps sync whole-row." A profile is never queried
 * independently either — one dive's series is read to draw one dive's chart.
 *
 * **`id` IS the dive's id.** There is exactly one series per dive, so this is a 1:1 extension
 * rather than a child collection: sharing the id makes "does this dive have a profile" a
 * primary-key lookup and makes re-import a plain upsert, with no join key and no unique index.
 *
 * Not a column on `dives`, deliberately: every screen reads dives and almost none reads
 * profiles, so a `series` column would make the app's most-travelled query carry ~3 KB of
 * profile per row for a chart that is not on screen.
 */
export const diveSamples = sqliteTable('dive_samples', {
  id: text('id').primaryKey(),
  series: seriesJson('series').notNull().default(sql`'[]'`),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
  dirty: dirtyFlag(),
});
```

Above it, beside `tanksJson`/`equipmentJson` (~line 68):

```ts
/**
 * One sample: `[seconds from dive start, depth m, °C or null, bar or null]`.
 *
 * A tuple rather than an object, and that is the encoding decision: ~12 bytes a point against
 * ~45 for `{t, d, temp, p}`, which is the difference between 2.7 KB and 10 KB for a 222-point
 * dive, on a row that syncs. Temperature and pressure are nullable because a dive logged
 * without a tank transmitter has no pressure at all (import spec §4.2).
 */
export type DiveSample = readonly [number, number, number | null, number | null];

const seriesJson = jsonArray<DiveSample>();
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: a new `src/db/migrations/0003_*.sql` creating `dive_samples`, plus an updated `meta/`. Read the generated SQL and confirm it creates exactly the five columns above.

- [ ] **Step 5: Write `src/db/diveSamples.ts`**

```ts
import { and, eq, isNull } from 'drizzle-orm';

import { type Db } from './client';
import { stampLocalWrite } from './dirty';
import { diveSamples, type DiveSample } from './schema';

/** Live rows only — a tombstoned series is gone as far as anything that draws is concerned,
 * even though the row itself survives so §7 can carry the deletion to other devices. */
const liveSeries = isNull(diveSamples.deletedAt);

/**
 * Writes a dive's profile, replacing whatever was there.
 *
 * An upsert on the dive's own id rather than an insert: re-importing the same file must not
 * produce a second series, and the import flow's dedupe (db/importDives.ts) is about *dives*,
 * not about this row. Un-tombstones on write, so a re-import after a delete restores the curve.
 */
export async function putDiveSamples(db: Db, diveId: string, series: readonly DiveSample[]): Promise<void> {
  const stamp = stampLocalWrite();
  await db
    .insert(diveSamples)
    .values({ id: diveId, series: [...series], createdAt: stamp.updatedAt, ...stamp })
    .onConflictDoUpdate({
      target: diveSamples.id,
      set: { series: [...series], deletedAt: null, ...stamp },
    });
}

/** A dive's profile, or `null` where there is none — which is most dives, and is not an error
 * (§0.4: no curve is drawn for a dive without a real sample series). */
export async function getDiveSamples(db: Db, diveId: string): Promise<DiveSample[] | null> {
  const [row] = await db
    .select()
    .from(diveSamples)
    .where(and(eq(diveSamples.id, diveId), liveSeries));
  if (!row) return null;
  return row.series.length > 0 ? row.series : null;
}

/** Marks a dive's series deleted without removing the row, so §7 carries the deletion. */
export async function tombstoneDiveSamples(db: Db, diveId: string): Promise<void> {
  const stamp = stampLocalWrite();
  await db
    .update(diveSamples)
    .set({ deletedAt: stamp.updatedAt, ...stamp })
    .where(and(eq(diveSamples.id, diveId), liveSeries));
}
```

Add `tombstoneDiveSamples` to the test file's imports.

- [ ] **Step 6: Run the tests**

Run: `npx jest src/db/diveSamples.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Run the whole suite — the parity tests will have opinions**

Run: `npm test`
Expected: `schemaParity.test.ts` **fails**, because the local schema now has a table Postgres does not. That is the guard rail working; Task 3 satisfies it. If it does *not* fail, stop and find out why before continuing — the guard rail is not guarding.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts src/db/diveSamples.ts src/db/diveSamples.test.ts src/db/migrations
git commit -m "Give a dive somewhere to keep its depth profile"
```

---

### Task 2: Deleting a dive tombstones its profile

**Files:**
- Modify: `src/db/dives.ts` (`softDeleteDive`, ~line 587)
- Test: `src/db/dives.test.ts`

**Interfaces:**
- Consumes: `tombstoneDiveSamples(db, diveId)` from Task 1
- Produces: nothing new

- [ ] **Step 1: Write the failing test**

```ts
// src/db/dives.test.ts — beside the other softDeleteDive tests
it('takes a dive’s depth profile with it when the dive is deleted', async () => {
  const db = await testDb();
  const dive = await createDive(db, { date: '2026-02-19' });
  await putDiveSamples(db, dive.id, [[0, 1.27, 27.7, 188.9]]);

  await softDeleteDive(db, dive.id);

  // Not merely hidden: the series is tombstoned, so §7 carries the deletion to every other
  // device rather than leaving a profile behind for a dive that no longer exists.
  expect(await getDiveSamples(db, dive.id)).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/db/dives.test.ts -t "depth profile with it"`
Expected: FAIL — `getDiveSamples` still returns the series.

- [ ] **Step 3: Tombstone the series inside `softDeleteDive`**

In `src/db/dives.ts`, after the dive's own update succeeds:

```ts
  // **A dive's profile goes with the dive** (import spec §3.5). Tombstoned rather than
  // deleted, for the same reason the dive itself is: §7 carries a deletion by writing
  // `deleted_at`, and a row removed outright would simply reappear on the next pull.
  //
  // After the dive's own update and only on success: a delete that did not find a live dive
  // has not deleted anything, and must not orphan-tombstone a profile.
  await tombstoneDiveSamples(db, id);
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/db/dives.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/dives.ts src/db/dives.test.ts
git commit -m "Let a deleted dive take its profile with it"
```

---

### Task 3: `dive_samples` becomes the sixth synced table

**Files:**
- Modify: `src/db/diveSamples.ts` (the five sync functions)
- Modify: `src/cloud/sync.ts` (`SYNCED_TABLES`, ~line 185)
- Modify: `supabase/migrations/20260902090100_schema.sql` (table + index)
- Modify: `supabase/migrations/20260902090200_rls.sql` (policies)
- Modify: `supabase/migrations/20260902090300_sync_rpcs.sql` (push/pull inclusion)
- Modify: `src/testing/migrationSql.ts` if the parity test needs the table listing
- Test: `src/db/diveSamples.test.ts`, and the three existing parity tests

**Interfaces:**
- Consumes: `pendingRows`, `clearDirtyFlags`, `countPendingRows`, `applyPulledRows`, `tombstoneAllRows`, `flagAllRows`, `type PushedRow`, `type LocalWriteStamp` (all `src/db/dirty.ts`)
- Produces: `pendingDiveSamples`, `clearDiveSampleDirtyFlags`, `countPendingDiveSamples`, `applyPulledDiveSamples`, `tombstoneAllDiveSamples`, `adoptDiveSamples`, `wipeDiveSamples`, `type PulledDiveSample`

- [ ] **Step 1: Write the failing test**

```ts
// src/db/diveSamples.test.ts
it('offers a freshly written series to the push, and stops once it has gone up', async () => {
  const db = await testDb();
  await putDiveSamples(db, 'dive-1', [[0, 1.27, 27.7, 188.9]]);

  const pending = await pendingDiveSamples(db);
  expect(pending.map((r) => r.id)).toEqual(['dive-1']);
  expect(await countPendingDiveSamples(db)).toBe(1);

  await clearDiveSampleDirtyFlags(db, pending.map((r) => ({ id: r.id, updatedAt: r.updatedAt })));
  expect(await countPendingDiveSamples(db)).toBe(0);
});

it('writes a series the server sent without flagging it to go straight back up', async () => {
  const db = await testDb();
  await applyPulledDiveSamples(db, [
    {
      id: 'dive-9',
      series: [[0, 5.5, 21, 200]],
      createdAt: '2026-02-19T11:22:08.000Z',
      updatedAt: '2026-02-19T11:22:08.000Z',
      deletedAt: null,
    },
  ]);
  expect(await getDiveSamples(db, 'dive-9')).toEqual([[0, 5.5, 21, 200]]);
  expect(await countPendingDiveSamples(db)).toBe(0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/db/diveSamples.test.ts -t "push"`
Expected: FAIL — `pendingDiveSamples is not a function`

- [ ] **Step 3: Add the five functions to `src/db/diveSamples.ts`**

Copy the shape from `src/db/certifications.ts:316-390` exactly — these are thin wrappers over `db/dirty.ts` and must not grow logic of their own.

```ts
/** The series this device still owes the server — `pendingRows` (db/dirty.ts). */
export async function pendingDiveSamples(db: Db): Promise<DiveSampleRow[]> {
  return db.select().from(diveSamples).where(pendingRows(diveSamples));
}

export async function clearDiveSampleDirtyFlags(db: Db, pushed: readonly PushedRow[]): Promise<string[]> {
  return clearDirtyFlags(db, diveSamples, pushed);
}

export async function countPendingDiveSamples(db: Db): Promise<number> {
  return countPendingRows(db, diveSamples);
}

/** A series as `pull_changes` hands it over — no `dirty`, which never leaves a device. */
export type PulledDiveSample = Omit<DiveSampleRow, 'dirty'>;

export async function applyPulledDiveSamples(db: Db, rows: readonly PulledDiveSample[]): Promise<string[]> {
  return applyPulledRows(db, diveSamples, rows);
}

export async function tombstoneAllDiveSamples(db: Db, stamp: LocalWriteStamp): Promise<string[]> {
  return tombstoneAllRows(db, diveSamples, stamp);
}

/** Claims every local series for the account that just signed in (§5's guest → account). */
export async function adoptDiveSamples(db: Db): Promise<void> {
  await flagAllRows(db, diveSamples);
}

/** Start over (§3) — rows removed outright, not tombstoned. */
export async function wipeDiveSamples(db: Db): Promise<void> {
  await db.delete(diveSamples).where(EVERY_ROW);
}
```

Add `type DiveSampleRow = typeof diveSamples.$inferSelect;` near the top.

- [ ] **Step 4: Register it in `src/cloud/sync.ts`**

Append a sixth entry to `SYNCED_TABLES`, after `certifications`:

```ts
  // **The sixth table, and it needed no protocol change** — a series is one row keyed by its
  // dive's id, so §7's whole-row LWW carries it exactly as it carries a dive. It is also
  // *immutable*: nothing in the app edits a profile, so the only conflict LWW can meet is a
  // re-import of the same file, whose content is identical.
  synced({
    table: diveSamples,
    pending: pendingDiveSamples,
    clear: clearDiveSampleDirtyFlags,
    apply: applyPulledDiveSamples,
    countPending: countPendingDiveSamples,
    tombstoneAll: tombstoneAllDiveSamples,
  }),
```

Also add `adoptDiveSamples` wherever `adoptCertifications` is called, and `wipeDiveSamples` wherever `wipeCertifications` is — `grep -rn "adoptCertifications\|wipeCertifications" src/` finds both call sites.

- [ ] **Step 5: Add the Postgres side**

In `supabase/migrations/20260902090100_schema.sql`, after the `certifications` table:

```sql
-- A dive's depth profile (import spec §3). One row per dive, and `id` IS the dive's id —
-- there is exactly one series per dive, so this is a 1:1 extension rather than a child
-- collection. `series` is the same JSON array of `[t, depth, temp, bar]` tuples the device
-- stores; Postgres never reads into it, so text is the honest column type.
create table if not exists public.dive_samples (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  series text not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
```

And beside the other `(user_id, updated_at)` indexes:

```sql
create index if not exists dive_samples_user_id_updated_at_idx on public.dive_samples (user_id, updated_at);
```

In `supabase/migrations/20260902090200_rls.sql`, copy the `certifications` block verbatim with the table renamed — same four statements, same three policies (`select_own`, `insert_own`, `update_own`).

In `supabase/migrations/20260902090300_sync_rpcs.sql`, add `dive_samples` wherever the other five private tables are enumerated in `push_changes` and `pull_changes`. Read the RPC bodies first: the pattern is per-table, and this table has no columns needing special handling.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS, including `schemaParity`, `syncRpcParity` and `catalogueRpcParity`. If a parity test still fails, read its message — it names the exact column or table that differs, and it is right.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/db/diveSamples.ts src/db/diveSamples.test.ts src/cloud/sync.ts supabase/migrations src/testing/migrationSql.ts
git commit -m "Carry a dive's profile to the account, as the sixth synced table"
```

---

### Task 4: The importer seam

**Files:**
- Create: `src/domain/import/types.ts`
- Create: `src/domain/import/registry.ts`
- Test: `src/domain/import/registry.test.ts`

**Interfaces:**
- Consumes: `NewDiveInput` (`src/db/dives.ts`), `DiveSample` (`src/db/schema.ts`)
- Produces: `DiveImporter`, `ImportedDive`, `ImportRefusal`, `importerFor(bytes): DiveImporter | null`, `IMPORTERS`, `importerLabels(): string[]`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/import/registry.test.ts
import { importerFor, importerLabels, IMPORTERS } from './registry';

const bytesOf = (text: string) => new TextEncoder().encode(text);

it('picks an importer by what a file contains, never by what it is called', async () => {
  const suunto = bytesOf(JSON.stringify({ DeviceLog: { Header: { DateTime: '2026-02-19T11:22:08.290+08:00' } } }));
  expect(importerFor(suunto)?.source).toBe('suunto-app-json');
});

it('recognises nothing in a JSON file that is simply not a dive export', async () => {
  // The case that makes extension-matching wrong: §9's PADI migration is also JSON, so the
  // file name can never decide which importer owns a `.json`.
  expect(importerFor(bytesOf('{"hello":"world"}'))).toBeNull();
});

it('recognises nothing in a file that is not text at all', async () => {
  expect(importerFor(new Uint8Array([0x00, 0x01, 0x02, 0xff]))).toBeNull();
});

it('names every format it knows, from the registry rather than from a second list', async () => {
  // The Settings caption is generated from this, so a format added without a label is a
  // caption that quietly stops naming everything the app can read.
  expect(importerLabels()).toHaveLength(IMPORTERS.length);
  expect(importerLabels().every((l) => l.length > 0)).toBe(true);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/domain/import/registry.test.ts`
Expected: FAIL — `Cannot find module './registry'`

- [ ] **Step 3: Write `src/domain/import/types.ts`**

```ts
import { type NewDiveInput } from '../../db/dives';
import { type DiveSample } from '../../db/schema';

/** One dive an importer read out of a file, in Ponor's own shape and units. */
export interface ImportedDive {
  /** Stable per source dive — see the Suunto importer for why it is normalised. */
  importId: string;
  dive: NewDiveInput;
  /** `null` for a dive the source recorded without a profile. */
  series: DiveSample[] | null;
}

/**
 * **One file format Ponor can read.** The whole contract is *bytes → normalised dives*;
 * dedupe, transactions, counting and the UI are written once, downstream of this
 * (`db/importDives.ts`).
 *
 * **`Uint8Array`, not `string`.** Three of §9's four named formats are text, but FIT is binary
 * — its sniff is bytes 8–11 equal to `.FIT`. Taking bytes costs text importers one shared
 * decode and saves reshaping this contract when a binary format arrives.
 */
export interface DiveImporter {
  /** Written to `dives.import_source`, and half of the dedupe key. */
  readonly source: string;
  /** What a diver reads in the Settings caption. A function, not a constant: a constant's
   * value is fixed before any diver has chosen a language (see `unnamedSite`). */
  label(): string;
  /** A cheap look at the bytes. Must not throw, whatever it is handed. */
  recognises(file: Uint8Array): boolean;
  /** Throws `ImportRefusal` when the file is this format and still cannot be read. */
  parse(file: Uint8Array): ImportedDive[];
}

/**
 * **A file this importer owns and still cannot read.**
 *
 * Distinct from "no importer recognised it", and the two produce different sentences for the
 * diver: an unrecognised file is a fixable mistake (wrong file), where a refusal is not.
 */
export class ImportRefusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ImportRefusal';
  }
}

/** Decodes bytes as UTF-8 for the text formats. Returns `''` for bytes that are not text,
 * so a `recognises` built on substring matching answers `false` instead of throwing. */
export function decodeUtf8(file: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(file);
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: Write `src/domain/import/registry.ts`**

```ts
import { suuntoJsonImporter } from './suunto';
import { type DiveImporter } from './types';

/**
 * **Every format Ponor can read**, in the order they are tried.
 *
 * A plain array on purpose: no dynamic registration, no plugin loading. Adding §9's UDDF,
 * Subsurface, FIT or PADI is a new file beside this one and a new entry here — and, because
 * detection is by content, no UI change at all.
 */
export const IMPORTERS: readonly DiveImporter[] = [suuntoJsonImporter];

/**
 * **Which importer owns this file, decided by its contents.**
 *
 * Never by extension, and that is needed today rather than later: §9's PADI migration is also
 * JSON, so two formats will share `.json` and the file name cannot decide between them.
 */
export function importerFor(file: Uint8Array): DiveImporter | null {
  return IMPORTERS.find((importer) => importer.recognises(file)) ?? null;
}

/** The formats a diver is told Ponor understands — read off the registry, so a format added
 * without a label cannot leave the Settings caption quietly out of date. */
export function importerLabels(): string[] {
  return IMPORTERS.map((importer) => importer.label());
}
```

- [ ] **Step 5: Run the tests**

Run: `npx jest src/domain/import/registry.test.ts`
Expected: FAIL — `Cannot find module './suunto'`. That is the next task; leave it failing and do not stub the importer to make this pass.

- [ ] **Step 6: Commit**

```bash
git add src/domain/import/types.ts src/domain/import/registry.ts src/domain/import/registry.test.ts
git commit -m "Give Ponor one way to ask what a dive file is"
```

---

### Task 5: The Suunto importer

**Files:**
- Create: `src/domain/import/suunto.ts`
- Create: `src/domain/import/__fixtures__/suunto-d5.json` (trimmed, anonymised)
- Create: `src/domain/import/__fixtures__/suunto-d5-no-transmitter.json` (trimmed, anonymised)
- Test: `src/domain/import/suunto.test.ts`

**Interfaces:**
- Consumes: `DiveImporter`, `ImportedDive`, `ImportRefusal`, `decodeUtf8` (Task 4); `calendarDateToLocalDate`-family helpers in `src/domain/datetime.ts`
- Produces: `suuntoJsonImporter: DiveImporter`

**Fixtures.** Build both from the owner's real exports, then **change the serial number to `000000000000` and cut the samples to about six**, keeping: an event-only sample with no `Depth`, the first depth-bearing sample at a non-zero offset, and a `Header.Depth.Max` deeper than any remaining sample. The real files carry the owner's device serial — which is half the dedupe key — and this repository is public.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/import/suunto.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ImportRefusal } from './types';
import { suuntoJsonImporter } from './suunto';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, '__fixtures__', `${name}.json`)));

const only = (name: string) => {
  const [dive] = suuntoJsonImporter.parse(fixture(name));
  if (!dive) throw new Error('no dive parsed');
  return dive;
};

it('recognises a Suunto export and refuses a JSON that is not one', () => {
  expect(suuntoJsonImporter.recognises(fixture('suunto-d5'))).toBe(true);
  expect(suuntoJsonImporter.recognises(new TextEncoder().encode('{"a":1}'))).toBe(false);
});

it('refuses a file it owns but cannot read, which is not the same as not recognising it', () => {
  const truncated = new TextEncoder().encode('{"DeviceLog":{"Header":{"DateTime":');
  expect(suuntoJsonImporter.recognises(truncated)).toBe(true);
  expect(() => suuntoJsonImporter.parse(truncated)).toThrow(ImportRefusal);
});

it('reads the local wall clock and does not convert it through UTC', () => {
  // +08:00 in the fixture. Converting would file this dive on 2026-02-19 at 03:22 UTC, and
  // §10 names exactly that trap. The date and time are the diver's, as written.
  const { dive } = only('suunto-d5');
  expect(dive.date).toBe('2026-02-19');
  expect(dive.timeIn).toBe('11:22');
});

it('takes max depth from the header, which is deeper than any sample', () => {
  // The device records its true maximum at a finer resolution than the 10 s series, so
  // deriving it from the samples under-reports every imported dive.
  const { dive, series } = only('suunto-d5');
  expect(dive.maxDepthM).toBe(24.33);
  expect(Math.max(...(series ?? []).map((s) => s[1]))).toBeLessThan(24.33);
});

it('records the temperature at the deepest sample, not the coldest of the dive', () => {
  const { dive } = only('suunto-d5');
  expect(dive.waterTempC).toBeCloseTo(27.4, 1);
});

it('converts the gas block into a tank, in Ponor’s units', () => {
  const { dive } = only('suunto-d5');
  expect(dive.tanks?.[0]).toMatchObject({
    sizeL: 12,          // 0.012 m³
    workingBar: 200,    // 20000000 Pa
    startBar: 188.9,    // 18889062 Pa
    endBar: 72.5,       // 7245312 Pa
    o2Pct: 21,          // 0.21
    hePct: 0,
  });
});

it('rounds the duration to whole minutes and ignores PauseDuration', () => {
  // 2211 s is the dive; the samples span 2210.9 s, so the separate PauseDuration is something
  // else and must reach nothing.
  const { dive } = only('suunto-d5');
  expect(dive.durationMin).toBe(37);
});

it('times the series from its own timestamps, never from index × interval', () => {
  // The file declares SampleInterval 10 and its real deltas drift, so an index-derived series
  // would disagree with the timestamps it claims to represent.
  const { series } = only('suunto-d5');
  expect(series?.[0]?.[0]).toBeCloseTo(0.57, 2);
  expect(series?.[0]?.[0]).not.toBe(0);
});

it('drops samples carrying no depth, which are the event-only records', () => {
  const { series } = only('suunto-d5');
  expect(series?.every((s) => typeof s[1] === 'number')).toBe(true);
});

it('keys a dive on its computer and its local start, to the second', () => {
  const { importId } = only('suunto-d5');
  expect(importId).toBe('000000000000:2026-02-19T11:22:08');
});

it('imports a dive logged without a transmitter, leaving the pressures blank', () => {
  // Verified against a real export: the header OMITS StartPressure/EndPressure as keys while
  // the samples keep Cylinders[0].Pressure and set it null — two shapes for one absence. And
  // TransmitterID is still present, so it is not the signal.
  const { dive, series } = only('suunto-d5-no-transmitter');
  expect(dive.tanks?.[0]).toMatchObject({ sizeL: 12, workingBar: 200, o2Pct: 21 });
  expect(dive.tanks?.[0]?.startBar).toBeNull();
  expect(dive.tanks?.[0]?.endBar).toBeNull();
  expect(series?.every((s) => s[3] === null)).toBe(true);
});

it('invents nothing the file does not carry', () => {
  const { dive } = only('suunto-d5');
  for (const field of ['siteName', 'centerName', 'buddy', 'guide', 'notes', 'title', 'rating',
                       'weightsKg', 'suit', 'entry', 'salinity', 'waterBody', 'latitude',
                       'longitude', 'airTempC', 'visibility', 'weather'] as const) {
    expect(dive[field] ?? null).toBeNull();
  }
});

it('marks where the dive came from, so a re-import can find it again', () => {
  const { dive } = only('suunto-d5');
  expect(dive.importSource).toBe('suunto-app-json');
  expect(dive.status).toBe('logged');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/domain/import/suunto.test.ts`
Expected: FAIL — `Cannot find module './suunto'`

- [ ] **Step 3: Write `src/domain/import/suunto.ts`**

```ts
import { type DiveSample } from '../../db/schema';
import { decodeUtf8, ImportRefusal, type DiveImporter, type ImportedDive } from './types';

const PASCALS_PER_BAR = 100_000;
const LITRES_PER_CUBIC_METRE = 1000;
const KELVIN_AT_ZERO_C = 273.15;
const SECONDS_PER_MINUTE = 60;

/**
 * `2026-02-19T11:22:08.290+08:00` → the diver's own date, minute and dedupe key.
 *
 * **Read out of the string, never through a `Date`.** §10 names the trap: `toISOString()` on a
 * dive picked late in the evening east of Greenwich files it under the previous day. The two
 * reference dives make it concrete — the same device wrote `+08:00` on one and `+02:00` on the
 * other, so the offset varies inside one logbook and is deliberately discarded.
 *
 * The key drops milliseconds and the offset: one computer cannot record two dives starting in
 * the same second, and a future export writing `Z` or a different precision must not produce a
 * second key for a dive already imported.
 */
function localParts(dateTime: string): { date: string; time: string; key: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?/.exec(dateTime);
  if (!m?.[1] || !m[2]) return null;
  return { date: m[1], time: m[2], key: `${m[1]}T${m[2]}${m[3] ?? ':00'}` };
}

/** A number the file actually carried. A missing key and an explicit `null` are one answer —
 * the pod-less export omits `StartPressure` entirely while its samples set `Pressure: null`. */
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const scaled = (v: unknown, by: number, dp: number): number | null => {
  const n = num(v);
  return n === null ? null : Number((n / by).toFixed(dp));
};

interface SuuntoSample {
  Depth?: number | null;
  Temperature?: number | null;
  TimeISO8601?: string;
  Cylinders?: { Pressure?: number | null }[];
}

export const suuntoJsonImporter: DiveImporter = {
  source: 'suunto-app-json',
  label: () => 'Suunto',

  /** A look, not a parse — it must answer for any bytes at all without throwing, including a
   * truncated file, which it deliberately still claims so `parse` can refuse it by name. */
  recognises(file) {
    const text = decodeUtf8(file);
    return text.includes('"DeviceLog"') && text.includes('"Header"');
  },

  parse(file) {
    let root: any;
    try {
      root = JSON.parse(decodeUtf8(file));
    } catch {
      throw new ImportRefusal('not valid JSON');
    }
    const log = root?.DeviceLog;
    const header = log?.Header;
    const startedAt = typeof header?.DateTime === 'string' ? header.DateTime : null;
    if (!startedAt) throw new ImportRefusal('no dive start time');
    const local = localParts(startedAt);
    // `date` is Ponor's one required column, so a start time it cannot read is a refusal
    // rather than a dive with an invented date.
    if (!local) throw new ImportRefusal('unreadable dive start time');

    const serial = String(log?.Device?.SerialNumber ?? header?.Device?.SerialNumber ?? 'unknown');
    const startMs = Date.parse(startedAt);

    const samples: SuuntoSample[] = Array.isArray(log?.Samples) ? log.Samples : [];
    // Event-only records carry no depth and are not part of the profile.
    const dived = samples.filter((s) => num(s?.Depth) !== null && typeof s?.TimeISO8601 === 'string');

    const series: DiveSample[] = dived.map((s) => [
      // From the sample's own timestamp, never index × SampleInterval: the file declares 10 s
      // and its real deltas run 9.74–10.10, so an index-derived series would drift against the
      // timestamps it claims to represent.
      Number(((Date.parse(s.TimeISO8601!) - startMs) / 1000).toFixed(2)),
      num(s.Depth)!,
      s.Temperature == null ? null : Number((s.Temperature - KELVIN_AT_ZERO_C).toFixed(1)),
      scaled(s.Cylinders?.[0]?.Pressure, PASCALS_PER_BAR, 1),
    ]);

    // The deepest sample that carries a temperature; ties resolve to the first. Owner's call
    // (2026-09-09): the temperature at depth, not the coldest of the dive.
    const deepest = dived.reduce<SuuntoSample | null>(
      (best, s) =>
        s.Temperature != null && (best === null || num(s.Depth)! > num(best.Depth)!) ? s : best,
      null,
    );

    const gases: any[] = Array.isArray(header?.Diving?.Gases) ? header.Diving.Gases : [];
    const tanks = gases.map((g) => ({
      material: null,
      configuration: null,
      sizeL: scaled(g?.TankSize, 1 / LITRES_PER_CUBIC_METRE, 1),
      workingBar: scaled(g?.TankFillPressure, PASCALS_PER_BAR, 1),
      // Read the pressures themselves. **Not** `TransmitterID`, which is present even on a
      // dive logged without a pod and would make `undefined` look like a reading.
      startBar: scaled(g?.StartPressure, PASCALS_PER_BAR, 1),
      endBar: scaled(g?.EndPressure, PASCALS_PER_BAR, 1),
      o2Pct: scaled(g?.Oxygen, 1 / 100, 0),
      hePct: scaled(g?.Helium, 1 / 100, 0),
    }));

    const duration = num(header?.Duration);
    const dive: ImportedDive = {
      importId: `${serial}:${local.key}`,
      series: series.length > 0 ? series : null,
      dive: {
        date: local.date,
        timeIn: local.time,
        // `Duration` is the dive; the samples span 2210.9 s against a stated 2211, so the
        // separate `PauseDuration` is something else and reaches nothing.
        durationMin: duration === null ? null : Math.round(duration / SECONDS_PER_MINUTE),
        // The header's own maximum, which is deeper than any sample: the device records it at
        // a finer resolution than the 10 s series, so deriving it here would under-report
        // every imported dive (24.29 sampled against 24.33 stated).
        maxDepthM: num(header?.Depth?.Max),
        avgDepthM: num(header?.Depth?.Avg),
        waterTempC:
          deepest?.Temperature == null ? null : Number((deepest.Temperature - KELVIN_AT_ZERO_C).toFixed(1)),
        tanks,
        status: 'logged',
        importSource: 'suunto-app-json',
        importId: `${serial}:${local.key}`,
      },
    };
    return [dive];
  },
};
```

Everything else is left null by omission — `NewDiveInput` is a `Partial`, so a field this file
does not set is a field the dive does not carry. That is the point: the export is the computer's
record, and §2.1's carry-over is a *form* mechanism that must not run here.

Rules the tests above pin:
- `recognises`: `decodeUtf8` then a substring check for `"DeviceLog"` and `"Header"`. Never parses, never throws.
- `parse`: `JSON.parse` inside try/catch → `ImportRefusal` on failure; a missing `Header.DateTime` is also a refusal, since `date` is Ponor's one required column.
- Pressures: read `StartPressure`/`EndPressure` **themselves**, treating a missing key and a `null` as the same answer. Do **not** branch on `TransmitterID` — it is present on pod-less dives.
- `waterTempC`: the temperature of the deepest depth-bearing sample that carries one; ties resolve to the first.
- Series: for each depth-bearing sample, `[(sampleTime − headerTime) in seconds, Depth, Temperature − 273.15 or null, Cylinders[0].Pressure ÷ 100000 or null]`.
- Return `[]` rather than throwing when the file is a valid `DeviceLog` holding no dive.

- [ ] **Step 4: Run the tests**

Run: `npx jest src/domain/import/suunto.test.ts src/domain/import/registry.test.ts`
Expected: PASS, both files.

- [ ] **Step 5: Commit**

```bash
git add src/domain/import/suunto.ts src/domain/import/suunto.test.ts src/domain/import/__fixtures__
git commit -m "Read a Suunto export into a dive Ponor can hold"
```

---

### Task 6: The shared writer

**Files:**
- Create: `src/db/importDives.ts`
- Test: `src/db/importDives.test.ts`

**Interfaces:**
- Consumes: `importerFor` (Task 4), `putDiveSamples` (Task 1), `createDive` (`src/db/dives.ts`), `ImportRefusal`
- Produces: `importFiles(db, files): Promise<ImportOutcome>`, `type ImportOutcome`, `type ImportFile`

- [ ] **Step 1: Write the failing test**

```ts
// src/db/importDives.test.ts
const file = (name: string, bytes: Uint8Array): ImportFile => ({ name, bytes });

it('imports a dive and its profile together', async () => {
  const db = await testDb();
  const out = await importFiles(db, [file('a.json', fixtureBytes('suunto-d5'))]);
  expect(out).toMatchObject({ imported: 1, alreadyThere: 0, failed: [] });
  const [dive] = await listDives(db);
  expect(dive?.maxDepthM).toBe(24.33);
  expect(await getDiveSamples(db, dive!.id)).not.toBeNull();
});

it('skips a dive it already has, and never overwrites the diver’s edits', async () => {
  // The whole reason duplicates are skipped: the file is immutable, the diver's copy is not.
  const db = await testDb();
  await importFiles(db, [file('a.json', fixtureBytes('suunto-d5'))]);
  const [before] = await listDives(db);
  await updateDive(db, before!.id, { siteName: 'Kotelna', buddy: 'Jana' });

  const out = await importFiles(db, [file('a.json', fixtureBytes('suunto-d5'))]);

  expect(out).toMatchObject({ imported: 0, alreadyThere: 1, failed: [] });
  const [after] = await listDives(db);
  expect(after?.siteName).toBe('Kotelna');
  expect(after?.buddy).toBe('Jana');
});

it('keeps going past a bad file and names the one that failed', async () => {
  const db = await testDb();
  const out = await importFiles(db, [
    file('good.json', fixtureBytes('suunto-d5')),
    file('junk.json', new TextEncoder().encode('{"hello":"world"}')),
    file('other.json', fixtureBytes('suunto-d5-no-transmitter')),
  ]);
  expect(out.imported).toBe(2);
  expect(out.failed).toEqual([{ name: 'junk.json', reason: 'unrecognised' }]);
  expect(await listDives(db)).toHaveLength(2);
});

it('tells an unrecognised file apart from one it recognised and could not read', async () => {
  const db = await testDb();
  const out = await importFiles(db, [
    file('junk.json', new TextEncoder().encode('{"hello":"world"}')),
    file('broken.json', new TextEncoder().encode('{"DeviceLog":{"Header":{"DateTime":')),
  ]);
  expect(out.failed).toEqual([
    { name: 'junk.json', reason: 'unrecognised' },
    { name: 'broken.json', reason: 'unreadable' },
  ]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/db/importDives.test.ts`
Expected: FAIL — `Cannot find module './importDives'`

- [ ] **Step 3: Write `src/db/importDives.ts`**

```ts
export interface ImportFile {
  name: string;
  bytes: Uint8Array;
}

export interface ImportOutcome {
  /** Dives written. */
  imported: number;
  /** Dives already present under the same (source, id) and left untouched. */
  alreadyThere: number;
  /** **Files**, not dives — a file that failed yielded none to count. */
  failed: { name: string; reason: 'unrecognised' | 'unreadable' }[];
}
```

```ts
import { and, eq } from 'drizzle-orm';

import { importerFor } from '../domain/import/registry';
import { ImportRefusal } from '../domain/import/types';
import { type Db } from './client';
import { putDiveSamples } from './diveSamples';
import { createDive } from './dives';
import { dives } from './schema';

/**
 * **Writes whatever an importer read, whichever importer read it.**
 *
 * Dedupe, transactions and counting live here and nowhere else, so adding §9's UDDF or FIT
 * touches `domain/import/` alone. Nothing in this file knows what a Suunto file looks like.
 */
export async function importFiles(db: Db, files: readonly ImportFile[]): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { imported: 0, alreadyThere: 0, failed: [] };

  for (const file of files) {
    const importer = importerFor(file.bytes);
    // Two sentences, because they are two different things for the diver: an unrecognised
    // file is a fixable mistake, a refused one is not.
    if (!importer) {
      outcome.failed.push({ name: file.name, reason: 'unrecognised' });
      continue;
    }

    let parsed;
    try {
      parsed = importer.parse(file.bytes);
    } catch (error) {
      // ImportRefusal is expected; anything else is a bug in an importer and must still not
      // take the batch down — §1's "a failure never blocks the rest", one door over.
      outcome.failed.push({ name: file.name, reason: 'unreadable' });
      if (!(error instanceof ImportRefusal)) console.warn('importer threw', error);
      continue;
    }

    for (const { importId, dive, series } of parsed) {
      // **Skipped, never overwritten.** The file is immutable — a dive that happened in
      // February does not change — but the diver's copy does: they may have added the site, a
      // buddy or notes since. Re-running the same folder must not destroy that.
      const [existing] = await db
        .select({ id: dives.id })
        .from(dives)
        .where(and(eq(dives.importSource, importer.source), eq(dives.importId, importId)));
      if (existing) {
        outcome.alreadyThere += 1;
        continue;
      }

      // Per dive, not per batch: one malformed file must not roll back the fourteen before it.
      const written = await createDive(db, dive);
      if (series) await putDiveSamples(db, written.id, series);
      outcome.imported += 1;
    }
  }

  return outcome;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/db/importDives.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/db/importDives.ts src/db/importDives.test.ts
git commit -m "Write imported dives once, whatever read them"
```

---

### Task 7: The Settings import flow

**Files:**
- Modify: `package.json` (add `expo-document-picker@~57.0.1`)
- Modify: `src/screens/SettingsScreen.tsx` (a `DATA IMPORT` section below `DATA EXPORT`)
- Create: `src/platform/pickImportFiles.ts`
- Modify: `src/i18n/en.ts`, `src/i18n/cs.ts`
- Test: `src/screens/SettingsScreen.test.tsx`, `src/platform/pickImportFiles.test.ts`

**Interfaces:**
- Consumes: `importFiles`, `type ImportOutcome` (Task 6); `importerLabels` (Task 4)
- Produces: `pickImportFiles(): Promise<ImportFile[] | 'cancelled' | 'unavailable'>`

**A native module is being added, so the dev client must be rebuilt** (`npx expo run:ios`) before this works on a device. Jest does not need it — `expo-document-picker` is mocked.

- [ ] **Step 1: Add the dependency**

```bash
npm install expo-document-picker@~57.0.1
```

- [ ] **Step 2: Write the failing screen test**

```ts
// src/screens/SettingsScreen.test.tsx
jest.mock('../platform/pickImportFiles', () => ({ pickImportFiles: jest.fn() }));
jest.mock('../db/importDives', () => ({ importFiles: jest.fn() }));

it('heads the import row with its own section, below data export', async () => {
  stubSettings();
  const t = await render(<SettingsScreen />);
  const lines = textIn(t);
  expect(lines.indexOf('Data import')).toBeGreaterThan(lines.indexOf('Data export'));
  expect(lines.indexOf('Import dives')).toBeGreaterThan(lines.indexOf('Data import'));
});

it('names every format it can read, from the registry rather than a typed list', async () => {
  stubSettings();
  const t = await render(<SettingsScreen />);
  for (const label of importerLabels()) {
    expect(textIn(t).join(' ')).toContain(label);
  }
});

it('says nothing at all when the diver backs out of the picker', async () => {
  stubSettings();
  mockPick.mockResolvedValue('cancelled');
  const t = await render(<SettingsScreen />);
  await pressControl(t, 'Import dives');
  expect(mockImportFiles).not.toHaveBeenCalled();
  expect(textIn(t).join(' ')).not.toContain('imported');
});

it('reports all three counts, since a diver needs to know which happened', async () => {
  stubSettings();
  mockPick.mockResolvedValue([{ name: 'a.json', bytes: new Uint8Array() }]);
  mockImportFiles.mockResolvedValue({
    imported: 12, alreadyThere: 2, failed: [{ name: 'junk.json', reason: 'unrecognised' }],
  });
  const t = await render(<SettingsScreen />);
  await pressControl(t, 'Import dives');
  await waitFor(() => {
    const said = textIn(t).join(' ');
    expect(said).toContain('12');
    expect(said).toContain('2');
    expect(said).toContain('junk.json');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx jest src/screens/SettingsScreen.test.tsx -t "import"`
Expected: FAIL — the section and row do not exist.

- [ ] **Step 4: Write `src/platform/pickImportFiles.ts`**

The one owner of "a file comes in from outside", the mirror of `shareFile.ts`. Reads each picked file's bytes with `new File(uri).bytes()` from `expo-file-system`. Returns `'cancelled'` for a dismissed picker and `'unavailable'` where no picker exists — the same three-state shape `shareFile` already uses, so the screen never sees an exception for an ordinary outcome.

- [ ] **Step 5: Add the strings to both languages**

`en.ts`, in the `settings` block after the export keys:

```ts
importSection: 'Data import',
importLabel: 'Import dives',
importFormats: 'Ponor can read: {{formats}}.',
importing: 'Importing…',
importDone: '{{imported}} imported, {{alreadyThere}} already in your logbook.',
importFailed: "Couldn't read: {{files}}.",
importUnavailable: 'No file picker is available on this device.',
```

`cs.ts` — the same keys. Note M3n: do not write `Ponor` where the sentence also means a dive.

```ts
importSection: 'Import dat',
importLabel: 'Importovat ponory',
importFormats: 'Aplikace umí přečíst: {{formats}}.',
importing: 'Importuji…',
importDone: 'Naimportováno {{imported}}, {{alreadyThere}} už v deníku bylo.',
importFailed: 'Nepodařilo se přečíst: {{files}}.',
importUnavailable: 'Na tomto zařízení není k dispozici výběr souborů.',
```

- [ ] **Step 6: Add the section to `SettingsScreen.tsx`**

Below the `DATA EXPORT` section, following the structure M3n established for `Location` and
`Account`. Do not build a preview screen, a merge UI or an undo.

```tsx
{/* §9's import, and the section name leaves room for UDDF and the rest without renaming
    anything. The caption's format list is generated from the registry (importerLabels), so a
    format added without a label cannot leave this sentence quietly out of date. */}
<Text style={styles.settingsSectionTitle}>{t('settings.importSection')}</Text>
<Pressable
  style={styles.formField}
  onPress={runImport}
  disabled={importing}
  accessibilityRole="button"
  accessibilityState={{ disabled: importing }}
  accessibilityLabel={t('settings.importLabel')}
>
  <View style={styles.formFieldRow}>
    <Text style={styles.formFieldLabel}>{t('settings.importLabel')}</Text>
  </View>
</Pressable>
<View style={styles.settingsCaption}>
  <Text style={styles.settingsCaptionText}>
    {t('settings.importFormats', { formats: importerLabels().join(', ') })}
  </Text>
  {importMessage !== null && <Text style={styles.settingsCaptionText}>{importMessage}</Text>}
</View>
```

```ts
const [importing, setImporting] = useState(false);
const [importMessage, setImportMessage] = useState<string | null>(null);

const runImport = async () => {
  setImporting(true);
  setImportMessage(t('settings.importing'));
  try {
    const picked = await pickImportFiles();
    // A cancelled picker is not a failure and says nothing at all.
    if (picked === 'cancelled') return setImportMessage(null);
    if (picked === 'unavailable') return setImportMessage(t('settings.importUnavailable'));

    const outcome = await importFiles(db, picked);
    const said = [t('settings.importDone', outcome)];
    // Three counts, and the units differ deliberately: dives imported, dives already there,
    // FILES that could not be read — a failed file yielded no dives to count.
    if (outcome.failed.length > 0) {
      said.push(t('settings.importFailed', { files: outcome.failed.map((f) => f.name).join(', ') }));
    }
    setImportMessage(said.join(' '));
  } finally {
    // Released on both paths, for the reason every busy flag in this app is: a control that
    // silently stopped working is the failure, not the failure it was reporting.
    setImporting(false);
  }
};
```

- [ ] **Step 7: Run everything**

```bash
npm test && npm run typecheck && npm run lint
```
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/platform/pickImportFiles.ts src/platform/pickImportFiles.test.ts src/screens/SettingsScreen.tsx src/screens/SettingsScreen.test.tsx src/i18n/en.ts src/i18n/cs.ts
git commit -m "Let a diver hand Ponor a folder of dives"
```

---

### Task 8: Verify on the device, and record it in DESIGN.md

**Files:**
- Modify: `DESIGN.md` (§3, §6, §7, §9, §10)

- [ ] **Step 1: Rebuild the dev client and import for real**

```bash
npx expo run:ios
```

Put both real exports somewhere the picker can reach (Files → On My iPhone), import them, and confirm on the device: two dives appear with the right dates, depths and pressures; the pod-less dive shows no RMV; a second import of the same files reports them as already there and changes nothing.

- [ ] **Step 2: Write the DESIGN.md entries**

Per spec §9: **§9** records imports moving out of v1.1 as the owner's call with the date, Suunto named as the first built; **§6** turns `dive_samples` from reserved prose into a real table, recording the `series` encoding and the `id`-is-the-dive's-id decision; **§7** five synced tables become six; **§3** Settings gains a `DATA IMPORT` section; **§10** gains three entries — JSON over FIT for Suunto and why (the pressures), detection by content rather than extension and why (two JSON formats), and skip-never-overwrite on duplicate import and why (the diver's copy has been edited since).

- [ ] **Step 3: Commit**

```bash
git add DESIGN.md
git commit -m "Record the importer, and the three decisions inside it"
```
