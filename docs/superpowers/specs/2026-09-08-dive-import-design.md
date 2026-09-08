# Dive import — design

> **Spec A of two.** This one gets dives *in*: file ingress, format detection, the Suunto
> mapping, the `dive_samples` table and its sync, and the import flow. **Spec B** is §0.4's
> profile rendering — the row sparkline and the detail chart — and is deliberately separate,
> because §0.4 forbids drawing a curve from anything but real samples, so the chart cannot be
> honestly built or tested until this spec has put a real series in the database.
>
> Status: approved in outline (owner, 2026-09-08), pending review of this document.

---

## 1. Why, and what the plan already says

DESIGN.md §9 puts "dive-computer & app import (UDDF / Subsurface / Garmin FIT, a PADI
migration, plus UDDF export)" after release, in v1.1. **The owner has moved it forward
deliberately** (2026-09-08) — this is a scope change to be recorded in §9, not a drift into it.

Three things the plan already decided, which this spec inherits rather than relitigates:

- **§6 reserves the columns.** `import_source` and `import_id` already exist on `dives`,
  "so future imports from dive computers or other apps can dedupe safely". They are unused today.
- **§6 reserves the table in prose only.** `dive_samples` is described as "UDDF-shaped
  depth/time series" but does not exist in `src/db/schema.ts`. This spec creates it.
- **§0.4 governs what may be drawn.** "Until `dive_samples` holds rows for a dive, no curve is
  drawn for it anywhere." Importing samples is therefore a precondition for Spec B, and this
  spec draws nothing.

## 2. Which format, and the evidence for it

The owner exported the same dive from the Suunto app as both **FIT** and **JSON**. Both were
decoded and compared. **The JSON is the format to import**, and the reasoning is worth keeping
because the general argument points the other way:

| Ponor field | Suunto JSON | Suunto FIT |
|---|---|---|
| max / avg depth | ✓ | ✓ |
| duration | ✓ | ✓ |
| water temperature | ✓ (0.05 K resolution) | ✓ (integer °C) |
| tank `o2Pct` | ✓ | ✓ |
| tank **`startBar` / `endBar`** | ✓ | **absent** |
| tank **`sizeL`** | ✓ | **absent** |
| tank **`workingBar`** | ✓ | **absent** |
| samples | 222, with per-sample pressure | 221, depth + temperature only |

The FIT export from this device carries **no tank pressure at all** — its `record` messages hold
only timestamp, depth and temperature, and its single `dive_gas` message holds only oxygen
percent. Five of `Tank`'s eight fields exist solely in the JSON.

The concrete consequence: **§2.1 computes RMV from average depth, time *and cylinder size***.
Import via FIT and every imported dive would show no RMV, leaving the Stats sparkline (M3d)
empty for the whole imported logbook.

FIT remains the right long-term target for a *generic* importer, exactly as §9 says. Suunto's
FIT export simply happens to be impoverished. §5 of this spec makes adding it cheap.

**Verified, not recalled.** Having both files for one dive allowed the FIT decoding to be
checked against a readable twin: FIT `record` field 92 read `1270` where the JSON's matching
sample read `Depth: 1.27`; session fields 140/141 read `17170`/`24330` against `Avg: 17.17` /
`Max: 24.33`; session 142 read `4548` against `SurfaceTime: 4548`. The comparison above rests on
two independent files agreeing, not on memory of the FIT profile.

**Scope of that evidence:** one dive, from a **Suunto D5**, written by `SuuntoFitExport1`. Other
devices or firmware may differ. §8 records what this leaves unverified.

## 3. Data model

### 3.1 The table

```
dive_samples
  id          text PK        -- the dive's own id
  series      text NOT NULL  -- JSON, arrays not objects
  updated_at  text NOT NULL
  deleted_at  text
  dirty       (device-only, per DEVICE_ONLY_COLUMNS)
```

**`id` is the dive's id.** There is exactly one series per dive, so this is a 1:1 extension of
the dive rather than a child collection. Sharing the id makes "does this dive have a profile" a
primary-key lookup, makes re-import a plain upsert, and needs neither a join key nor a unique
index. It is still a client-generated UUIDv7 — just the dive's, not a fresh one.

### 3.2 `series` encoding

One entry per sample, **arrays rather than objects**:

```json
[[0.57, 1.27, 27.7, 188.9], [10.31, 2.96, 27.7, 188.0], ...]
```

`[seconds from dive start, depth m, °C or null, bar or null]`. The reference dive's first
depth-bearing sample really does land at 0.57 s rather than 0 — the device records its first
depth a moment after the dive start it stamps in the header. Roughly 12 bytes a point — about
2.7 KB for the 222-point reference dive.

- **Time is seconds from the dive's start**, as a number, computed from each sample's own
  `TimeISO8601` minus `Header.DateTime`. **Never index × `SampleInterval`**: the reference file
  declares an interval of 10 s and its actual deltas range 9.74–10.10 s (median 10.01), so an
  index-derived series would drift against the timestamps it claims to represent.
- **Temperature and pressure ride along** because the Suunto file carries them per sample and a
  gas-consumption view would need them. Spec B's chart reads only the first two.
- Samples with no depth are dropped (the reference file has 246 entries, 222 with a depth; the
  rest are event-only records).

### 3.3 Why a table, not 221 rows, and not a column on `dives`

**Not many rows.** §10 already settled this shape for the same reason, about `tanks`: "a JSON
array on the dive row, not a child table: never queried independently; keeps sync whole-row." A
depth profile is never queried independently either — one dive's series is read to draw one
dive's chart.

**Not a column on `dives`.** Every screen in the app reads dives; almost none reads profiles. A
`series` column would make the app's most-travelled query carry ~3 KB of profile per row for a
chart that is not on screen.

### 3.4 Sync

`dive_samples` becomes the **sixth synced table**, through the existing whole-row LWW protocol
with **no protocol change** — it is one more `synced({...})` entry in `SYNCED_TABLES`
(`src/cloud/sync.ts`), alongside `dives`, `gear_presets`, `certifications`, `dive_sites` and
`dive_centers`.

**A series is immutable.** Nothing in the app edits a profile, so there is no conflict case
beyond LWW picking the newer row — and re-importing the same file produces identical content.
That makes LWW trivially correct here in a way it is not for a dive.

**On the 1 MiB ceiling.** §9's web spike records that "a synchronous result over 1 MiB never
returns at all", sized at "~600 bytes a dive". That ceiling is **`wa-sqlite`'s bridge buffer in
`client.web.ts`** — the browser path — and §9 calls web "a testing target, not a supported
platform". Native `expo-sqlite` has no such limit. It is named here because it was briefly
mistaken for a general constraint during design, and because the browser build will need to page
its pulls once a logbook carries profiles.

**Server cost:** ~3 KB a dive. A 500-dive logbook is 1.5 MB. §8's cost note does not move.

### 3.5 What this touches

| Piece | Work |
|---|---|
| `src/db/schema.ts` | the table |
| `src/db/migrations/0003_*.sql` | drizzle-kit generated |
| `supabase/migrations/` | Postgres table, RLS policy, inclusion in the sync RPCs |
| `src/db/diveSamples.ts` | `pendingDiveSamples`, `clearDiveSampleDirtyFlags`, `applyPulledDiveSamples`, `countPendingDiveSamples`, `tombstoneAllDiveSamples` |
| `src/cloud/sync.ts` | a sixth `synced({...})` entry |
| `src/db/dives.ts` | deleting a dive tombstones its series too |

`schemaParity.test.ts`, `syncRpcParity.test.ts` and `catalogueRpcParity.test.ts` read both
schemas from their own source and compare them, so a column added on one side and not the other
fails a test rather than syncing to nowhere. That guard rail is what makes adding a synced table
safe here.

## 4. The Suunto importer

### 4.1 Field mapping

| Ponor | Suunto JSON | Conversion |
|---|---|---|
| `date` | `Header.DateTime` | local date part |
| `timeIn` | `Header.DateTime` | local `HH:MM` |
| `durationMin` | `Header.Duration` (2211 s) | ÷ 60, rounded → 37 |
| `maxDepthM` | `Header.Depth.Max` | 24.33 |
| `avgDepthM` | `Header.Depth.Avg` | 17.17 |
| `waterTempC` | temperature of the deepest sample | 300.55 K → 27.4 |
| `tanks[0].sizeL` | `Gases[0].TankSize` (m³) | × 1000 → 12 |
| `tanks[0].workingBar` | `Gases[0].TankFillPressure` (Pa) | ÷ 100000 → 200 |
| `tanks[0].startBar` | `Gases[0].StartPressure` (Pa) | ÷ 100000 → 188.9 |
| `tanks[0].endBar` | `Gases[0].EndPressure` (Pa) | ÷ 100000 → 72.5 |
| `tanks[0].o2Pct` | `Gases[0].Oxygen` (fraction) | × 100 → 21 |
| `tanks[0].hePct` | `Gases[0].Helium` (fraction) | × 100 → 0 |
| `status` | — | `'logged'` |
| `importSource` | — | `'suunto-app-json'` |
| `importId` | `Device.SerialNumber` + normalised `Header.DateTime` | `000000000000:2026-02-19T11:22:08` |

### 4.2 The rules behind that table

**The date is local, and the offset is not applied.** `Header.DateTime` is
`2026-02-19T11:22:08.290+08:00` — the dive's own local wall clock. Ponor stores `date` and
`timeIn` as local strings (§10), so the correct read takes the local fields and **ignores** the
offset. Converting through UTC is the exact trap §10 names for `toISOString()`: it would file an
evening dive under the previous day. `domain/datetime.ts` remains the only owner of both string
forms; this importer calls it and never builds a date string itself.

**Max depth comes from the header, not from the samples.** The deepest sample in the reference
file reads 24.29 m where `Header.Depth.Max` reads 24.33 m — the device records its true maximum
at a finer resolution than the 10 s series. Deriving max depth from the samples would
under-report every imported dive.

**Water temperature is the temperature at the deepest sample** (owner's call, 2026-09-08), not
the minimum over the dive and not the mean. In the reference file that is 27.4 °C, against a
minimum of 27.0 °C. Precisely: the temperature of the deepest sample that carries one; where
several samples tie for deepest, the first of them. The fallback exists because the rule must be
total — the reference file has a temperature on all 222 depth-bearing samples and a single
deepest sample, so neither branch is exercised by it.

**`Duration` is the dive; `PauseDuration` is not part of it.** The depth samples span 2210.9 s
against a stated `Duration` of 2211, so the two agree and the separate `PauseDuration: 163` is
something else. It is not added, and it is not mapped anywhere.

**Every gas becomes a tank, and this is the weakest link.** Ponor's `tanks` is an array, so the
mapping is natural. But Suunto lists gas *mixtures*, not cylinders: a diver carrying one cylinder
with a deco mix configured would produce two `Gases` entries, which this mapping would log as two
cylinders. See §8 — this is unverified and needs a real multi-gas export to settle.

**`importId` is normalised, not the raw string.** The key is the serial number, a colon, and
the dive's **local wall clock to the second** — `2026-02-19T11:22:08` — with the milliseconds and
the UTC offset dropped. The raw `Header.DateTime` would work today and is brittle: a future
export writing `Z` instead of `+08:00`, or a different millisecond precision, would produce a
different key for the same dive and silently re-import it as a duplicate. Dropping to
whole-second local time is safe because one computer cannot record two dives starting in the same
second, and the serial number is what separates two computers.

**Nothing is invented.** Left null: site, centre, buddy, guide, notes, title, rating, weights,
weights feel, suit, suit thickness, equipment, entry, salinity, water body, latitude, longitude,
air temperature, visibility and its distance, waves, current, surge, weather. None appear
anywhere in the file — the export is the *computer's* record, not the Suunto app's logbook entry.
Tank `material` and `configuration` are likewise null.

**No carry-over on import.** §2.1's prefill is a *form* mechanism. Filling an imported dive's
buddy or suit from a neighbouring dive would manufacture exactly the "looks like data and is not"
failure that §2.1's fresh/carried split exists to prevent. An imported dive states what the
computer recorded and nothing else.

**Dive numbers need no mapping.** §2.5 computes them from chronology, so imported dives slot into
place and renumber everything after them automatically.

## 5. The multi-format seam

Suunto is the first format, not the only one — §9 names UDDF, Subsurface, Garmin FIT and a PADI
migration. The seam is **one interface**; everything downstream is written once.

```ts
interface DiveImporter {
  source: string;                          // → importSource, e.g. 'suunto-app-json'
  label: () => string;                     // what the diver reads; a function, per unnamedSite
  recognises(file: Uint8Array): boolean;   // a cheap sniff
  parse(file: Uint8Array): ImportedDive[]; // throws ImportRefusal carrying a reason
}

interface ImportedDive {
  importId: string;
  dive: NewDiveInput;      // already SI, already Ponor's shape
  series: Sample[] | null;
}
```

**Detection is by content, never by file extension — and that is required today.** §9's PADI
migration is also JSON, so two formats will share `.json` and the name cannot decide. The picker
offers the union of extensions and `recognises` picks the handler.

**The consequence is that there is no format picker in the UI.** The row reads *Import dives*;
the diver selects files and the app works out what they are. Adding UDDF later is a new file in
`src/domain/import/` and one entry in the registry array — zero UI change. The Settings caption
naming which formats are understood is generated **from** the registry, so it cannot drift from
what is actually supported.

**`Uint8Array`, not `string`.** Three of §9's four named formats are text, but FIT is binary —
its sniff is bytes 8–11 equal to `.FIT`. Taking bytes now means FIT needs no reshaping of this
contract later; text importers decode through one shared helper. `expo-file-system`'s `File`
exposes both `bytes()` and `text()`, so this costs nothing.

**Recognition and parsing are separate on purpose.** They produce two different sentences for the
diver: *no importer recognised this file* is a fixable mistake (wrong file), where *this is a
Suunto export and it could not be read* is not. A single "failed" would collapse them.

## 6. Ingress and the import flow

**`expo-document-picker` at `~57.0.1`**, SDK-aligned with the project's other Expo packages,
`multiple: true`. The share-sheet route ("Open in Ponor") was rejected: `.json` is a generic type,
so Ponor would offer itself for every JSON file on the device, and a share sheet cannot express
"pick 200 of these".

**One real cost: it is a native module, so the dev client must be rebuilt** before import works
on a device.

**Where it lives:** Settings, a `DATA IMPORT` section directly below `DATA EXPORT` — they are
twins, and §3 already lists export there. The section name leaves room for §9's other formats
without renaming anything. (M3n gave `Location` and `Account` their own sections; this follows
that structure.)

**The flow.** Tap → system picker → for each file: read bytes, find the importer that recognises
it, parse, and for each dive it yields check `(importSource, importId)` against existing dives,
then write. A summary lands in the same `settingsCaption` treatment the export row already uses.

**Each dive is its own transaction.** One malformed file must not roll back fourteen good ones,
and the batch never aborts on a failure — it counts it and continues. That is §1's "sync failures
never block logging" applied one door over.

**Duplicates are skipped, never overwritten.** A dive already carrying that
`(importSource, importId)` is left exactly as it is. The file is immutable — a dive that happened
in February does not change — but *the diver's copy does*: they may have added the site, a buddy,
notes or a rating since importing. Re-running the same folder must not destroy the work Ponor
exists to hold. This is also what makes a lost device recoverable: re-import is idempotent by
construction.

**A cancelled picker is not a failure** and says nothing at all.

**Three counts, always all three**, and the units differ deliberately: **dives** imported,
**dives** already present, **files** that could not be read — a failed file yields no dives to
count. Files that failed are named.

**A file with no samples still imports.** The summary fields are real; there is simply no curve,
which §0.4 already handles.

**Deliberately not built:** no preview-and-confirm screen, no merge UI, no background import, no
per-format settings, no dynamic registration or plugin loading, and **no undo** — an accepted
cost, since each dive is individually deletable and the act is deliberate.

## 7. Testing

**The mapping carries the weight**, because it is a pure function from bytes to a dive and
because every judgement call in §4.2 is falsifiable against a real file:

- the local date and time survive an offset that would shift the day under UTC conversion
- max depth comes from the header and not from the deeper-resolution-losing samples
- water temperature is the deepest sample's, not the minimum
- `PauseDuration` reaches nothing
- Pa → bar, m³ → L, fraction → percent, each at a value that would look plausible if wrong
- series times come from timestamps, not from index × interval
- a dive with no `Gases` imports with an empty `tanks` array rather than a null tank

**Recognition** gets its own tests: a Suunto file is recognised, a JSON that is not a `DeviceLog`
is not, and a truncated Suunto file is recognised and then refused — the two-sentence
distinction from §5.

**The writer** gets tests for dedupe (a second import of the same file writes nothing), partial
failure (one bad file among three leaves the other two imported), and per-dive transactions.

**The table and its sync** are covered by the three existing parity tests plus a round-trip test
for `series`.

### 7.1 Fixture, and a privacy point

The reference export is committed as a **trimmed, anonymised fixture** — a fake serial number, a
handful of samples rather than 222 — under `src/domain/import/__fixtures__/`. **This repository is
public and the real file carries the owner's device serial number**, which is also half the
dedupe key. The full file stays out of git.

The trimmed fixture keeps every *shape* the mapping depends on: the offset-bearing `DateTime`, a
`Gases` entry with all six mapped fields, depth-bearing and event-only samples, and a header
max depth deeper than any sample.

## 8. What is unverified, and what would settle it

Named rather than implied, in the spirit of §9's own M0 and M1 honesty notes.

- **Multi-gas dives.** One `Gases` entry is all the reference file has. The "every gas becomes a
  tank" rule would log a single cylinder with a deco mix as two cylinders. **Settled by:** one
  exported nitrox-deco dive.
- **Other Suunto devices and firmware.** The evidence is one dive from a Suunto D5 written by
  `SuuntoFitExport1`. **Settled by:** an export from a second device.
- **A dive with no tank transmitter.** The reference dive has one, which is why pressures are
  present at all. A dive logged without one presumably omits `StartPressure`/`EndPressure`, and
  the mapping must leave those null rather than write zeros. The code will handle absent fields;
  the *shape* of their absence is unverified. **Settled by:** one dive logged without a
  transmitter.
- **Volume.** No import of hundreds of files has been run. Per-dive transactions and a single
  picker call are the design's answer, but the wall-clock cost is unmeasured.

## 9. DESIGN.md changes this spec requires

To be made when the work lands, not before:

- **§9** — imports move from "after release, v1.1" into the current milestone, recorded as the
  owner's call with the date. The line naming UDDF / Subsurface / FIT / PADI stays; Suunto joins
  it as the first built.
- **§6** — `dive_samples` stops being "reserved" and becomes a real table; its `series` encoding
  and the `id`-is-the-dive's-id decision are recorded there.
- **§7** — the five synced tables become six.
- **§10** — three entries: the JSON-over-FIT choice for Suunto and why (pressures), detection by
  content rather than extension and why (two JSON formats), and skip-never-overwrite on duplicate
  import and why (the diver's copy has been edited since).
- **§3** — Settings gains a `DATA IMPORT` section.

## 10. Out of scope

- §0.4's profile sparkline and detail chart — **Spec B**.
- UDDF, Subsurface, FIT and PADI importers. §5 makes each a new file plus a registry entry; none
  is built here.
- UDDF *export*, which §9 lists alongside import.
- Importing anything that is not a dive: Suunto's `Windows`, tissue loading, algorithm state.
- Photos, which §9 places elsewhere in v1.1.
