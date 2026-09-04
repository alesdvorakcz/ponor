import { and, eq, getTableColumns } from 'drizzle-orm';

import { storedOptionalCalendarDate } from '../domain/datetime';
import { newId } from '../domain/ids';
import { compareCertifications } from '../domain/certifications';
import type { Certification } from '../domain/types';
import {
  applyPulledRows,
  clearDirtyFlags,
  countPendingRows,
  flagAllRows,
  pendingRows,
  stampLocalWrite,
  type PushedRow,
} from './dirty';
import { certifications } from './schema';
import { liveRows } from './tombstone';
import type { Db } from './types';
import { EVERY_ROW } from './wipe';

/**
 * Every write to a certification (DESIGN.md §3's wallet, §6's table), and the
 * `undefined` = don't touch / `null` = clear patch contract — `db/dives.ts` and
 * `db/gearPresets.ts` are this file's two models, and §4.1 gains a third row for the same
 * reason it holds the other two: a screen issuing its own UPDATE would be outside every rule
 * in `db/dirty.ts`, and would fail nothing.
 *
 * **The server half already exists.** M2a created `public.certifications`, `push_changes`
 * upserts it and `pull_changes` returns it — so until this file there was a table on the
 * server that no device could write and a payload key that `readChangeSet` threw away.
 * `src/db/schemaParity.test.ts` is what ties the two column lists together.
 */

/**
 * Fields nothing may set after the row is created — the same five `db/dives.ts` and
 * `db/gearPresets.ts` name, for the same reasons: `id` is the primary key, `createdAt` is the
 * audit trail (§2.5 reads it as an ordering tier and §7 preserves it), `updatedAt` is stamped
 * by the writers below, `deletedAt` only ever moves through `softDeleteCertification`, and
 * `dirty` is a consequence of a write rather than its subject — a patch able to carry
 * `dirty: false` is a caller telling the repository that the server has seen something it has
 * not.
 */
const IMMUTABLE_FIELDS = ['id', 'createdAt', 'updatedAt', 'deletedAt', 'dirty'] as const;
type ImmutableField = (typeof IMMUTABLE_FIELDS)[number];

/**
 * Anything a caller may set, and **nothing is required** — unlike a dive, which keeps its
 * date, and a preset, which keeps its name. §6 makes every column here nullable and
 * `Certification`'s own docblock says why: there is no one field the others are meaningless
 * without.
 *
 * That a wholly empty card may not be *authored* is a different claim and lives where a
 * screen can act on it (`certificationRefusal`, domain/certifications.ts). It is not enforced
 * here for `presetNamed`'s stated reason: a check inside the repository would need the same
 * verdict a screen has already computed, and would leave that screen with nothing to *say*.
 */
export type NewCertificationInput = Partial<Omit<Certification, ImmutableField>>;

/**
 * What `updateCertification` accepts: any of the five fields, each either a new value or
 * `null` to clear it.
 *
 * **The untouched/cleared distinction `GearPresetPatch` deliberately does not carry.** A
 * preset's two columns are NOT NULL, so neither can be cleared and "here is the new value" is
 * the whole vocabulary; every column here is nullable, so `null` has to mean *clear this* and
 * a carried `undefined` has to mean *leave it alone* — which is exactly `DivePatch`'s
 * contract, enforced below by the same `withoutUndefinedFields` rule (see `db/dives.ts` for
 * the entry time this silently erased before that rule existed).
 */
export type CertificationPatch = Partial<Omit<Certification, ImmutableField>>;

/**
 * Type-level proof that the `certifications` row and the `Certification` domain type describe
 * the same shape, so `toCertification`'s cast below has a contract to lean on. The assertion
 * `db/dives.ts`'s `Mutual` and `db/gearPresets.ts`'s `MutualGearPreset` both make; if it stops
 * compiling, `schema.ts` and `domain/types.ts` have drifted apart — fix the drift, do not
 * loosen this.
 */
type Assert<T extends true> = T;
export type MutualCertification = Assert<
  (typeof certifications.$inferSelect extends Certification ? true : false) extends true
    ? (Certification extends typeof certifications.$inferSelect ? true : false)
    : false
>;

/**
 * The tombstone filter for this table (`liveRows`, db/tombstone.ts) — the rule `liveDives` and
 * `livePresets` name for theirs, from the same owner rather than a third `isNull` written
 * here. Every read below goes through it.
 */
const liveCertifications = liveRows(certifications);

function toCertification(row: typeof certifications.$inferSelect): Certification {
  // A plain widening, unlike `toDive`/`toGearPreset`: every column here is `text` or the
  // boolean flag, so there is no JSON blob to re-check `Array.isArray` on and no integer
  // affinity to round. `MutualCertification` above is what makes it sound.
  return row;
}

/**
 * The two date columns as they are stored — `storedOptionalCalendarDate` (domain/datetime.ts,
 * §4.1's owner of every `YYYY-MM-DD`), which canonicalises a real date however it was spelled,
 * maps a blank to the null the column already uses for "no date", and stores anything else
 * unchanged because §1 does not let a write boundary reject.
 *
 * Applied **here**, at the one write path, exactly as `db/dives.ts` applies its own to `date`
 * and `timeIn` — so it holds for the editor, for a test, and for whatever hands a row in next.
 * The three *text* fields are blanked at the form boundary instead (`certificationRefusal`),
 * which is where `diveFormSchema`'s `optionalText` does the same job for a dive's `buddy`.
 *
 * Only keys carrying a real value are touched: `undefined` is checked as well as `in`, so this
 * holds for a key present with `undefined` and not merely for an absent one — the callers pass
 * through `withoutUndefinedFields` first and this repeats the condition rather than depending
 * on that having happened.
 */
function withNormalisedDates<T extends object>(input: T): T {
  const out = { ...input } as Record<string, unknown>;
  if (out.issuedOn !== undefined) out.issuedOn = storedOptionalCalendarDate(out.issuedOn);
  if (out.expiresOn !== undefined) out.expiresOn = storedOptionalCalendarDate(out.expiresOn);
  return out as T;
}

/**
 * `NewCertificationInput`'s `Omit` keeps `IMMUTABLE_FIELDS` out at the type level, but that
 * guarantee is compile-time only — a cast or an untyped payload could still carry one, and a
 * bare `{ ...patch }` would spread it straight into the statement. Same strip `db/dives.ts`
 * and `db/gearPresets.ts` apply, and for the same reasons.
 */
function withoutImmutableFields<T extends object>(patch: T): Omit<T, ImmutableField> {
  const safe = { ...patch } as Record<string, unknown>;
  for (const field of IMMUTABLE_FIELDS) delete safe[field];
  return safe as Omit<T, ImmutableField>;
}

/**
 * Drops keys carried with `undefined`, keeping keys set to `null` — `db/dives.ts`'s rule, and
 * the failure it records is exactly reachable here: every column is nullable, so a carried
 * `undefined` written through would ERASE a field the caller never mentioned, with no error
 * and a resolved promise.
 */
function withoutUndefinedFields<T extends object>(patch: T): T {
  const out = { ...patch } as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out as T;
}

export async function createCertification(
  db: Db,
  input: NewCertificationInput = {},
): Promise<Certification> {
  // The clock and the dirty flag from one stamp, and `createdAt` from the same one — see
  // `stampLocalWrite` (db/dirty.ts); `createDive` and `createGearPreset` are written
  // identically.
  const stamp = stampLocalWrite();
  const id = newId();
  const row = {
    ...withNormalisedDates(withoutUndefinedFields(withoutImmutableFields(input))),
    id,
    createdAt: stamp.updatedAt,
    ...stamp,
    deletedAt: null,
  };
  // RETURNING rather than a trailing `getCertification`, for the two reasons `createDive`
  // records: the read-back is part of the same atomic statement as the INSERT rather than a
  // second one a concurrent write could land between, and a field the input left unset comes
  // back as the column's real NULL rather than as an absent key.
  const rows = await db.insert(certifications).values(row).returning();
  const created = rows.at(0);
  if (created === undefined) {
    throw new Error(`createCertification: insert returned no row: ${id}`);
  }
  return toCertification(created);
}

export async function getCertification(db: Db, id: string): Promise<Certification | null> {
  const rows = await db
    .select()
    .from(certifications)
    .where(and(eq(certifications.id, id), liveCertifications))
    .limit(1);
  // `rows.at(0)` plus an explicit undefined check rather than a length check and `rows[0]`:
  // TypeScript cannot narrow an element type from `.length`.
  const row = rows.at(0);
  return row === undefined ? null : toCertification(row);
}

/**
 * The wallet read, tombstone-filtered and deliberately UNSORTED — `gearPresetRowsQuery`'s
 * shape and the same split for the same reason: `listCertifications` awaits it, and
 * `useCertifications` hands it to drizzle's `useLiveQuery`, which needs a synchronous query it
 * can re-run on every database change. The order is `compareCertifications`' alone
 * (domain/certifications.ts), applied in `toCertifications` below, so the two readers cannot
 * disagree about it.
 */
export function certificationRowsQuery(db: Db) {
  return db.select().from(certifications).where(liveCertifications);
}

/**
 * Raw rows to sorted domain certifications — `toGearPresets`' counterpart and the same
 * contract. Takes `unknown[]` because `useLiveQuery`'s `.data` is typed that loosely, and
 * sorts what it is given rather than trusting the caller's order, because `useLiveQuery` makes
 * no ordering promise at all.
 */
export function toCertifications(rows: unknown[]): Certification[] {
  return (rows as (typeof certifications.$inferSelect)[])
    .map(toCertification)
    .sort(compareCertifications);
}

/** Every live card, newest first. A thin wrapper over the two parts above, so this async read
 * and `useCertifications`' reactive one cannot diverge. */
export async function listCertifications(db: Db): Promise<Certification[]> {
  return toCertifications(await certificationRowsQuery(db));
}

/**
 * Edits a card: any of its five fields, `null` to clear one.
 *
 * **A write that changes nothing must not advance `updated_at`.** §7 is whole-row
 * last-write-wins keyed on that column, so a no-op write makes the device that did nothing
 * win the conflict against the device that did something. `updateDive` closes this by diffing
 * in the domain before it is ever called; `updateGearPreset` compares its two values here
 * because a preset has no diff to hand it. This is the second shape and needs the stricter
 * form of it: the editor hands over **all five fields every time** (it has no dirty tracking —
 * see `CertificationScreen`), so an unchanged Save arrives as a full patch that is not empty
 * and would write. The comparison is therefore per field, against the row as it stands, over
 * the values as they will actually be stored — dates already canonicalised, because
 * `2026-8-1` and `2026-08-01` are the same date and re-storing one as the other is not an
 * edit.
 *
 * **The read-then-write window is the one `updateGearPreset` documents**, and closed the same
 * way as far as it can be: both the read and the write are scoped to `liveCertifications`, so
 * a row tombstoned in between produces the same "not found" a missing one does; what remains
 * is a concurrent *edit* making this call's "nothing changed" verdict stale, which is the
 * window `updateDive` has one layer up and which needs a transaction this repository
 * deliberately does not open.
 */
export async function updateCertification(
  db: Db,
  id: string,
  patch: CertificationPatch,
): Promise<Certification> {
  const named = withoutImmutableFields(patch) as Record<string, unknown>;

  // A key that names no column is dropped by Drizzle's SET builder and the update runs anyway
  // — so a patch of entirely mistyped keys does not merely fail to write, it *succeeds and
  // bumps updated_at*, and that row then wins a sync conflict against a genuine edit made on
  // another device. `updateDive` carries the executed version of this (`{ maxDepth: 30 }` left
  // the column alone, returned a row, and advanced the clock). Checked BEFORE undefined keys
  // are dropped, deliberately: a key that names no column is malformed whatever its value.
  const columns = getTableColumns(certifications);
  const unknown = Object.keys(named).filter((key) => !(key in columns));
  if (unknown.length > 0) {
    throw new Error(`updateCertification: unknown field(s): ${unknown.join(', ')} (${id})`);
  }

  const current = await getCertification(db, id);
  if (current === null) throw new Error(`updateCertification: certification not found: ${id}`);

  const safe = withNormalisedDates(withoutUndefinedFields(named)) as Record<string, unknown>;
  // Every field that would be written back exactly as it already stands is dropped, so what is
  // left is the real edit or nothing at all. Compared with `!==` over `string | null` values,
  // which is the whole domain of these five columns — there is no object here for identity to
  // give the wrong answer about, which is why this needs nothing like `sameTanks`.
  const stored = current as unknown as Record<string, unknown>;
  const changes = Object.fromEntries(
    Object.entries(safe).filter(([key, value]) => value !== stored[key]),
  );

  // A patch that asks for what is already stored is a successful no-op: not an error, and not
  // a write. It returns the row a real edit would have returned for the same id, so a caller
  // cannot tell "you changed nothing" from "your change was already there" — which is correct,
  // because they are the same outcome. Throwing here would fail an ordinary Save on an editor
  // the diver opened and changed nothing in.
  if (Object.keys(changes).length === 0) return current;

  const rows = await db
    .update(certifications)
    .set({ ...changes, ...stampLocalWrite() })
    .where(and(eq(certifications.id, id), liveCertifications))
    .returning();
  const row = rows.at(0);
  if (row === undefined) throw new Error(`updateCertification: certification not found: ${id}`);
  return toCertification(row);
}

/**
 * Tombstones the card. Rows are never hard-deleted (§6) so the deletion propagates to the
 * diver's other devices (§7.2).
 *
 * Scoped to `liveCertifications` and rejects when nothing matched, rather than no-op-ing on an
 * id that was never real — the "nothing may silently do nothing" rule `softDeleteDive` and
 * `softDeleteGearPreset` both follow.
 */
export async function softDeleteCertification(db: Db, id: string): Promise<void> {
  // A delete is a write and its tombstone has to go up, so it carries the flag exactly as the
  // other two soft deletes do — and `deletedAt` comes from the same stamp.
  const stamp = stampLocalWrite();
  const result = await db
    .update(certifications)
    .set({ deletedAt: stamp.updatedAt, ...stamp })
    .where(and(eq(certifications.id, id), liveCertifications))
    .returning({ id: certifications.id });
  if (result.length === 0) throw new Error(`softDeleteCertification: certification not found: ${id}`);
}

/**
 * Every card still waiting to go up (§7.1), tombstoned ones included — `pendingDives`'
 * counterpart, and see `pendingRows` (db/dirty.ts) for why the tombstone filter is absent.
 */
export async function pendingCertifications(db: Db): Promise<Certification[]> {
  const rows = await db.select().from(certifications).where(pendingRows(certifications));
  return rows.map(toCertification);
}

/** Clears the flag on cards that have gone up, and only where the card has not been edited
 * since it was read for the push — see `clearDirtyFlags` (db/dirty.ts). */
export async function clearCertificationDirtyFlags(
  db: Db,
  pushed: readonly PushedRow[],
): Promise<string[]> {
  return clearDirtyFlags(db, certifications, pushed);
}

/** How many cards this device still owes the server — `countPendingRows` (db/dirty.ts). */
export async function countPendingCertifications(db: Db): Promise<number> {
  return countPendingRows(db, certifications);
}

/** A card as `pull_changes` hands it over — `PulledDive` (db/dives.ts) for why the flag is
 * missing from the type rather than merely unset. */
export type PulledCertification = Omit<Certification, 'dirty'>;

/** Writes cards the server sent, clean, and only where they may safely replace what is here —
 * `applyPulledRows` (db/dirty.ts) is the rule. */
export async function applyPulledCertifications(
  db: Db,
  rows: readonly PulledCertification[],
): Promise<string[]> {
  return applyPulledRows(db, certifications, rows);
}

/**
 * §7.4's adoption, for certifications — `flagAllRows` (db/dirty.ts) is the rule, and
 * `adoptDives` (db/dives.ts) carries the reasoning. Nothing is counted here: §7.4's sentence
 * names dives, and `cloud/localLogbook.ts`'s `adopt` says why that number is deliberately a
 * subset.
 */
export async function adoptCertifications(db: Db): Promise<void> {
  await flagAllRows(db, certifications);
}

/**
 * §7.4's sign-out erase, for certifications.
 *
 * **A wallet came from the account and therefore goes**, which is §7.4's own line —
 * "everything that came from an account goes, everything the diver set on this device stays".
 * A card is one person's, it syncs, and a signed-out phone still holding somebody's
 * certification numbers is precisely the state §7.4 calls "the only way a second account could
 * ever see them".
 *
 * `wipeDives` carries the reasoning for why this is a hard delete where
 * `softDeleteCertification` is a tombstone, and `db/wipe.ts` carries why the WHERE that looks
 * like a no-op is the difference between the rows going and the screen being told they went.
 */
export async function wipeCertifications(db: Db): Promise<void> {
  await db.delete(certifications).where(EVERY_ROW);
}
