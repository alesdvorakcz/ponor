import { csvDocument } from '../format/csv';
import { displayNumber, unitLabel, type Quantity, type UnitSystem } from '../format/units';
import { assignDiveNumbers, compareDiveOrder, isDiveCount } from './diveNumber';
import type {
  Certification,
  Dive,
  DiveCenter,
  DiveSite,
  GearPreset,
  Tank,
} from './types';

/**
 * **What a data export contains, and what each of the two files is** (DESIGN.md §8's
 * compliance list: "full data export any time — CSV for spreadsheets, JSON for portability
 * (GDPR Art. 20)").
 *
 * Pure, and reads nothing: `db/exportSource.ts` gathers the rows and this decides what becomes
 * of them. That split is what lets every rule below be tested against a fixture rather than
 * against a database, and it is what keeps this file free of the `db/` → `cloud/` import
 * direction the app already has.
 *
 * ── Two files, two jobs, and the difference decides everything else ───────────────────────
 *
 * **The JSON is the faithful one.** Every row of the diver's own data, every column, SI as
 * stored (§6), nothing derived. It is the file that could rebuild the logbook and the one that
 * answers portability.
 *
 * **The CSV is a spreadsheet.** One row per dive, headers a person reads, and figures in the
 * units that diver's Settings are set to. The two files are not two copies of one decision:
 * because the faithful copy exists beside it, the CSV is free to be convenient.
 *
 * ── The unit convention, which is the CSV's substance ─────────────────────────────────────
 *
 * **The CSV follows the diver's own unit setting, and every unit-bearing header names the
 * unit it is in** — `max_depth_ft` for an imperial diver, `max_depth_m` for a metric one. The
 * brief for this milestone put the trade as friendly-but-ambiguous against
 * unambiguous-but-wrong-for-a-feet-diver, and naming the unit in the header takes both halves:
 * an imperial diver reads the figures they logged, and the file still says what it means the
 * day it leaves their hands. **The suffix comes from `unitLabel`** (format/units.ts, §4.1's
 * owner of the unit words), never from a literal here, so a column cannot claim a unit the app
 * does not convert to.
 *
 * **Figures are written with a decimal point, in both languages.** `format/units.ts`'s
 * `figureText` puts a comma there for a Czech reader and is right to — for a sentence. A comma
 * inside a number in a comma-separated file is the one ambiguity the quoting rules exist to
 * prevent, and it would make a Czech diver's archive and an English diver's archive two
 * different formats. So the CSV asks `displayNumber` for the **number** and writes it, rather
 * than asking `format/display.ts` for the sentence.
 *
 * **Vocabulary values are the stored token, not the translated word** — `shore`, `salt`,
 * `semidry`. `domain/types.ts` guarantees every member is "one lowercase word that means
 * itself", so nothing is lost to a reader, and the alternative would make the same logbook
 * export differently depending on which language the app happened to be in.
 *
 * ── Computed values, which a CSV has no mark for ──────────────────────────────────────────
 *
 * §0.6 marks every derived value with a muted `=` "precisely so nobody mistakes them for
 * something entered", and a CSV cell has no ink. Worse, the mark itself is unusable: a cell or
 * header beginning `=` is a **formula** to Excel and Sheets.
 *
 * So the CSV carries **exactly one computed value, the dive number, in a column named
 * `computed_dive_number`** — the mark moved into the header, where a CSV can carry it.
 *
 * The dive number is in because it is not a measurement, it is the **name a diver calls the
 * row by**, and it is the one derived figure a spreadsheet cannot recover for itself: §2.5
 * computes it from `dives_before` and from five ordering tiers, neither of which is in the
 * grid. Surface interval, used pressure, gas used, RMV, MOD and nitrogen are all out, and for
 * the opposite reason — each is one formula away from columns that *are* in the grid, which is
 * what a spreadsheet is for, and every one of them in a cell would be a derived figure sitting
 * in a row of recorded ones with nothing to say so.
 *
 * A **planned** dive has no dive number (§2.4) and its cell is therefore empty, not a zero and
 * not a guess — §0.4's instinct, and the `status` column is what says why.
 *
 * ── What is exported at all ───────────────────────────────────────────────────────────────
 *
 * The diver's own data: dives, cylinder presets, certifications, and the community sites and
 * centres **they created** (`isOwnCatalogueRow` below). Not the rest of the catalogue — those
 * rows are everybody's, and a copy of them is not this diver's data under Art. 20.
 *
 * Tombstoned rows are absent because every read this is built from applies §4.1's own
 * tombstone filter; a dive the diver deleted is a dive they deleted.
 */

/**
 * Everything an export is made of, already read. `db/exportSource.ts` builds it.
 *
 * `divesBefore` is deliberately `unknown` rather than `number`, for `assignDiveNumbers`' own
 * stated reason: it comes out of a `text` settings column and may be anything a corrupt row
 * can be. Forwarded unchanged, so the one place that decides what an unusable count means is
 * `isDiveCount` (domain/diveNumber.ts) — the same degradation the dive list already shows.
 */
export interface ExportSource {
  readonly dives: readonly Dive[];
  readonly gearPresets: readonly GearPreset[];
  readonly certifications: readonly Certification[];
  readonly diveSites: readonly DiveSite[];
  readonly diveCenters: readonly DiveCenter[];
  readonly divesBefore: unknown;
  /** The instant the export was taken, in `stampLocalWrite`'s own spelling. */
  readonly exportedAt: string;
  /** The diver's local calendar date (`todayCalendarDate`), which names the files. */
  readonly exportedOn: string;
}

/** One file, ready to be written and handed to the share sheet. */
export interface ExportFile {
  readonly name: string;
  readonly text: string;
}

/**
 * **Whether a community row is one this diver contributed** (§5, §2.3), in two tiers.
 *
 * `created_by` is the server's answer and the ordinary one: it arrives with the pulled row and
 * names the diver who added the site. It cannot be the only tier, because a site created on a
 * boat carries **no** `created_by` at all until a push has been echoed back — the column is in
 * `db/catalogue.ts`'s `SERVER_AUTHORED` set and is stripped on the way in. Exporting on
 * `created_by` alone would therefore drop precisely the site a diver added this morning, which
 * is the "partial export that looks complete" this milestone is most afraid of.
 *
 * The second tier is the flag. §7.1's `dirty` means "waiting to go up", and on a catalogue
 * table only a row **this device created** is ever dirty: `applyPulledRows` (db/dirty.ts)
 * writes every pulled row clean and the device edits no catalogue row after creating it. So a
 * dirty row is this diver's by construction.
 *
 * A `null` `created_by` on a **clean** row is somebody else's — §5 severs authorship when a
 * diver deletes their account — so it is not claimed. That is the whole reason the two tiers
 * are separate conditions rather than one `createdBy === ownerId || createdBy === null`.
 *
 * `ownerId` is `null` for a device with nobody signed in, and then only the flag can answer.
 * That costs nothing in practice: §7.4 wipes both catalogue tables on sign-out and a guest
 * never pulls one, so a signed-out device has nothing here but its own unpushed rows.
 */
export function isOwnCatalogueRow(
  row: Pick<DiveSite, 'createdBy' | 'dirty'>,
  ownerId: string | null,
): boolean {
  if (row.dirty) return true;
  return ownerId !== null && row.createdBy === ownerId;
}

/**
 * The header suffix for a unit-bearing column — `m`, `ft`, `bar`, `psi`, `c`, `f`, `kg`, `lb`.
 *
 * Derived from `unitLabel` (§4.1) and then reduced to what a column name may hold: `°C` is the
 * word a diver reads and `water_temp_°c` is not a header. Lowercasing and dropping everything
 * that is not a letter or a digit is a transformation of the one owner's answer rather than a
 * second list of unit words — add a fifth pair to `format/units.ts` and this follows it.
 */
function headerUnit(quantity: Quantity, system: UnitSystem): string {
  return unitLabel(quantity, system)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** A stored string as a cell: itself, or empty where nothing was recorded. Never a dash and
 * never a placeholder — §0.4's instinct, applied to a file. */
function textCell(value: string | null): string {
  return value ?? '';
}

/**
 * A stored number as a cell, in the unit it is stored in.
 *
 * A value that is not a real number was never a reading — the same judgement
 * `format/display.ts` and `domain/derived.ts` each make privately for their own output, made
 * here because a CSV cell is neither a sentence nor a gas calculation. It becomes an empty
 * cell rather than `NaN`, which a spreadsheet would show as text in a numeric column.
 */
function numberCell(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/**
 * A stored SI value as a cell in the diver's own units — converted and rounded by
 * `displayNumber` (format/units.ts), which owns both, and written as a plain number.
 */
function measureCell(quantity: Quantity, value: number | null, system: UnitSystem): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return String(displayNumber(quantity, value, system));
}

/**
 * One CSV column: **its header and its cell, in one object**.
 *
 * That pairing is the point rather than a convenience. A header list and a cell list written
 * side by side are two places that have to agree about how many columns there are and what
 * order they come in — and when they stop agreeing, every value in every row shifts one place
 * and the file still parses. Here a column cannot exist without both halves.
 */
interface Column {
  readonly header: string;
  readonly cell: (dive: Dive) => string;
}

/** A column holding a stored SI measurement, whose header names the unit it was converted to. */
function measure(
  base: string,
  quantity: Quantity,
  system: UnitSystem,
  read: (dive: Dive) => number | null,
): Column {
  return {
    header: `${base}_${headerUnit(quantity, system)}`,
    cell: (dive) => measureCell(quantity, read(dive), system),
  };
}

/**
 * The eight fields of one cylinder, as columns prefixed `cylinder_1_`, `cylinder_2_`, …
 *
 * **Every cylinder is flattened onto the dive's own row**, rather than the first one only or a
 * second file. §6 stores `tanks` as a JSON array and a spreadsheet cannot hold one, so
 * something has to give; a first-cylinder-only file would silently drop the stage bottle from
 * exactly the dives whose diver most cares about gas, and a second file would break the one
 * thing a CSV is for — one row per dive. The block count follows the widest rig the logbook
 * actually holds, so a diver who has only ever dived a single sees one block.
 *
 * `size_l` carries no unit suffix because a cylinder's size has no imperial counterpart in
 * this app — `format/units.ts`'s own docblock names it as one of the four quantities with no
 * pair, since the cubic foot measures free gas rather than water capacity.
 */
function cylinderColumns(index: number, system: UnitSystem): Column[] {
  const prefix = `cylinder_${String(index + 1)}`;
  const tank = (dive: Dive): Tank | undefined => dive.tanks[index];
  const field = <T>(read: (tank: Tank) => T | null): ((dive: Dive) => T | null) => {
    return (dive) => {
      const found = tank(dive);
      return found === undefined ? null : read(found);
    };
  };
  const pressure = (name: string, read: (tank: Tank) => number | null): Column =>
    measure(`${prefix}_${name}`, 'pressure', system, field(read));
  return [
    { header: `${prefix}_material`, cell: (dive) => textCell(field((t) => t.material)(dive)) },
    {
      header: `${prefix}_configuration`,
      cell: (dive) => textCell(field((t) => t.configuration)(dive)),
    },
    { header: `${prefix}_size_l`, cell: (dive) => numberCell(field((t) => t.sizeL)(dive)) },
    pressure('working_pressure', (t) => t.workingBar),
    { header: `${prefix}_o2_pct`, cell: (dive) => numberCell(field((t) => t.o2Pct)(dive)) },
    { header: `${prefix}_he_pct`, cell: (dive) => numberCell(field((t) => t.hePct)(dive)) },
    pressure('start_pressure', (t) => t.startBar),
    pressure('end_pressure', (t) => t.endBar),
  ];
}

/**
 * How many cylinder blocks the file needs: the widest rig in the logbook, and **never fewer
 * than one**.
 *
 * The floor is not a filled gap (§0.4) — an empty cell is still empty. It is what keeps the
 * file's shape stable for the diver who has recorded no cylinders yet, so the columns still
 * say where a cylinder would go rather than the whole idea of one vanishing from their export.
 */
function cylinderBlocks(dives: readonly Dive[]): number {
  return dives.reduce((widest, dive) => Math.max(widest, dive.tanks.length), 1);
}

/**
 * Every column of the dives sheet, in §6's own cluster order: what identifies the dive, where
 * it was, what the water was like, what was worn, who was there, what the diver wrote, and
 * finally the cylinders.
 *
 * **Ids are absent, and so is the sync bookkeeping.** A UUID is noise in a spreadsheet, and
 * `created_at` / `updated_at` / `manual_order` / `import_source` describe how the row is
 * stored rather than what the diver did. All of it is in the JSON, which is the file that
 * promises completeness; this one promises a legible dive table.
 */
function diveColumns(
  dives: readonly Dive[],
  numbers: ReadonlyMap<string, number>,
  system: UnitSystem,
): Column[] {
  const columns: Column[] = [
    {
      header: 'computed_dive_number',
      cell: (dive) => numberCell(numbers.get(dive.id) ?? null),
    },
    { header: 'status', cell: (dive) => dive.status },
    { header: 'date', cell: (dive) => dive.date },
    { header: 'time_in', cell: (dive) => textCell(dive.timeIn) },
    { header: 'duration_min', cell: (dive) => numberCell(dive.durationMin) },
    { header: 'site', cell: (dive) => textCell(dive.siteName) },
    { header: 'center', cell: (dive) => textCell(dive.centerName) },
    { header: 'entry', cell: (dive) => textCell(dive.entry) },
    { header: 'salinity', cell: (dive) => textCell(dive.salinity) },
    { header: 'water_body', cell: (dive) => textCell(dive.waterBody) },
    { header: 'latitude', cell: (dive) => numberCell(dive.latitude) },
    { header: 'longitude', cell: (dive) => numberCell(dive.longitude) },
    measure('max_depth', 'depth', system, (dive) => dive.maxDepthM),
    measure('avg_depth', 'depth', system, (dive) => dive.avgDepthM),
    measure('water_temp', 'temperature', system, (dive) => dive.waterTempC),
    measure('air_temp', 'temperature', system, (dive) => dive.airTempC),
    { header: 'visibility', cell: (dive) => textCell(dive.visibility) },
    // A distance in metres, so it takes the same pair a depth does — `format/units.ts`'s
    // `DIVE_FIELD_QUANTITY` already classifies it that way.
    measure('visibility', 'depth', system, (dive) => dive.visibilityM),
    { header: 'waves', cell: (dive) => numberCell(dive.waves) },
    { header: 'current', cell: (dive) => numberCell(dive.current) },
    { header: 'surge', cell: (dive) => numberCell(dive.surge) },
    { header: 'weather', cell: (dive) => textCell(dive.weather) },
    { header: 'suit', cell: (dive) => textCell(dive.suit) },
    // Millimetres in both systems — the fourth quantity with no pair (format/units.ts).
    { header: 'suit_thickness_mm', cell: (dive) => numberCell(dive.suitThicknessMm) },
    // Space-separated, and that is safe rather than lucky: `domain/types.ts` guarantees every
    // member of a closed vocabulary is "one lowercase word that means itself", so no token can
    // contain the separator. A comma would have been the natural list mark and is the one
    // character this file may not spend on anything else.
    { header: 'equipment', cell: (dive) => dive.equipment.join(' ') },
    measure('weights', 'weight', system, (dive) => dive.weightsKg),
    { header: 'weights_feel', cell: (dive) => textCell(dive.weightsFeel) },
    { header: 'buddy', cell: (dive) => textCell(dive.buddy) },
    { header: 'guide', cell: (dive) => textCell(dive.guide) },
    { header: 'title', cell: (dive) => textCell(dive.title) },
    { header: 'notes', cell: (dive) => textCell(dive.notes) },
    { header: 'rating', cell: (dive) => numberCell(dive.rating) },
  ];
  for (let index = 0; index < cylinderBlocks(dives); index += 1) {
    columns.push(...cylinderColumns(index, system));
  }
  return columns;
}

/**
 * The dives, in the order §2.5 puts them in, **oldest first**.
 *
 * `compareDiveOrder` (domain/diveNumber.ts) rather than a comparison written here — §4.1, and
 * the same tiers that decide the numbers, so the `computed_dive_number` column ascends down
 * the sheet instead of arguing with the row order. Ascending rather than the dive list's own
 * newest-first, because a logbook is read forward and a spreadsheet is sorted by its first
 * column by reflex.
 *
 * **Planned dives are included, at their own date** (§2.4). They are the diver's data; §2.4
 * keeps them out of stats and numbering, not out of existence, and the `status` column plus an
 * empty dive number is what tells a reader which is which.
 */
function orderedDives(dives: readonly Dive[]): Dive[] {
  return [...dives].sort(compareDiveOrder);
}

/** What the two files are called. The diver's own calendar date, so a folder of exports sorts
 * by when they were taken. */
const CSV_NAME = 'ponor-dives';
const JSON_NAME = 'ponor-logbook';

/**
 * **The spreadsheet file: one row per dive, headers in the diver's own units.**
 *
 * A logbook with no dives still produces a file, and it is a header row on its own rather than
 * an empty file — "nothing here" and "the export failed" are different answers, and only one
 * of them is worth putting in a diver's Files app.
 */
export function csvExport(source: ExportSource, system: UnitSystem): ExportFile {
  const dives = orderedDives(source.dives);
  const numbers = assignDiveNumbers(dives, source.divesBefore);
  const columns = diveColumns(dives, numbers, system);
  const records = [
    columns.map((column) => column.header),
    ...dives.map((dive) => columns.map((column) => column.cell(dive))),
  ];
  return { name: `${CSV_NAME}-${source.exportedOn}.csv`, text: csvDocument(records) };
}

/**
 * A row as the JSON carries it: everything the app holds about it **except `dirty`**.
 *
 * The flag is §7.1's, "local by design" in `db/schema.ts`'s own words — it says whether this
 * device still owes the server a copy, which is a fact about this phone at this instant and
 * not about the diver's dive. It is the one thing in a row that would mean nothing to whoever
 * receives the file, and something misleading to whoever re-imported it.
 *
 * Typed as `Omit<T, 'dirty'>` rather than stripped from a `Record`, so the key is checked by
 * the compiler and this cannot go on deleting a column that has been renamed.
 */
function withoutDirtyFlag<T extends { dirty: boolean }>(row: T): Omit<T, 'dirty'> {
  const copy: Omit<T, 'dirty'> & { dirty?: boolean } = { ...row };
  delete copy.dirty;
  return copy;
}

/** What the JSON says it is, so a tool reading one in five years knows what it has. */
const EXPORT_FORMAT = 'ponor-logbook-export';
const EXPORT_VERSION = 1;

/**
 * **The faithful file: every row of the diver's own data, every column, SI as stored.**
 *
 * The keys are the app's own camelCase, which is §6's TypeScript side of the one mapping this
 * schema has — and it is the spelling that keeps the file internally consistent, since §6
 * fixes the interior of the `tanks` blob as camelCase whatever the columns around it are
 * called. Nothing here is derived, converted or worded: `units: 'si'` says so in the file.
 *
 * `divesBefore` is included because without it §2.5's numbering cannot be reproduced from this
 * file at all — and it is written as `null` when the stored value is not a count, rather than
 * as a `0` that would silently renumber a rebuilt logbook by the diver's whole history.
 *
 * Indented, because a diver may well open it, and two spaces is cheaper than the alternative
 * of handing somebody a single 400 kB line.
 */
export function jsonExport(source: ExportSource): ExportFile {
  const payload = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: source.exportedAt,
    units: 'si',
    divesBefore: isDiveCount(source.divesBefore) ? source.divesBefore : null,
    dives: orderedDives(source.dives).map(withoutDirtyFlag),
    gearPresets: source.gearPresets.map(withoutDirtyFlag),
    certifications: source.certifications.map(withoutDirtyFlag),
    diveSites: source.diveSites.map(withoutDirtyFlag),
    diveCenters: source.diveCenters.map(withoutDirtyFlag),
  };
  return {
    name: `${JSON_NAME}-${source.exportedOn}.json`,
    text: `${JSON.stringify(payload, null, 2)}\n`,
  };
}
