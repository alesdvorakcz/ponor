import { eq } from 'drizzle-orm';

import {
  createCertification,
  getCertification,
  listCertifications,
  softDeleteCertification,
  toCertifications,
  updateCertification,
} from './certifications';
import { certifications } from './schema';
import { createTestDb, type TestDb } from './testDb';

/**
 * **DESIGN.md §3's certification wallet, at the repository.**
 *
 * The flag, the erase and the pull are `dirty.test.ts`'s and `wipe.test.ts`' subjects, from
 * the census both of them run over every repository; what is left for this file is what is
 * specific to *this* table, and all of it fails silently:
 *
 * · **Every column is nullable**, so `undefined` = don't touch and `null` = clear are two
 *   different instructions on all five fields — where `db/gearPresets.ts` has neither case
 *   because both its columns are NOT NULL. A carried `undefined` written through would ERASE a
 *   field the caller never mentioned, with no error and a resolved promise (`db/dives.ts`
 *   records that exact defect costing a dive its entry time).
 * · **A write that changes nothing must not advance `updated_at`**, which §7's whole-row
 *   last-write-wins is keyed on — and the editor hands over all five fields on every save, so
 *   an unchanged Save arrives as a full patch rather than as an empty one.
 * · **The two date columns go through `domain/datetime.ts`** (§4.1), so a real date spelled
 *   loosely is canonicalised and a blank is the null the column already uses for "no date".
 */

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});

/** Long enough for `new Date().toISOString()` to move — the other repositories' own `tick`. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const aCard = () =>
  createCertification(db, {
    agency: 'PADI',
    course: 'Rescue Diver',
    cardNumber: '1234567',
    issuedOn: '2018-07-14',
    expiresOn: null,
  });

/** The row as the column actually holds it, past every read that filters or maps. */
async function storedRow(id: string): Promise<Record<string, unknown>> {
  const rows = await db.select().from(certifications).where(eq(certifications.id, id));
  const row = rows.at(0);
  if (row === undefined) throw new Error(`no certification ${id}`);
  return row as unknown as Record<string, unknown>;
}

describe('creating a card', () => {
  it('stores every field it was given and reads them back', async () => {
    const card = await aCard();

    expect(await getCertification(db, card.id)).toMatchObject({
      agency: 'PADI',
      course: 'Rescue Diver',
      cardNumber: '1234567',
      issuedOn: '2018-07-14',
      expiresOn: null,
      deletedAt: null,
      dirty: true,
    });
  });

  /**
   * §6 makes every column here nullable and `Certification`'s docblock says why: there is no
   * one field the others are meaningless without. A repository that required one would be a
   * rule §6 does not state, enforced where no screen could report it.
   */
  it('accepts a card with nothing in it at all, which is §6 and not laxity', async () => {
    const card = await createCertification(db);

    expect(await getCertification(db, card.id)).toMatchObject({
      agency: null,
      course: null,
      cardNumber: null,
      issuedOn: null,
      expiresOn: null,
    });
  });

  /** A field the input never mentioned comes back as the column's real NULL rather than as an
   * absent key — `createDive`'s stated reason for RETURNING over a trailing read. */
  it('answers a field it was not given as null rather than as a missing key', async () => {
    const card = await createCertification(db, { agency: 'SSI' });

    expect('course' in card).toBe(true);
    expect(card.course).toBeNull();
  });

  it('gives the card its own id, and one that differs from the next card’s', async () => {
    const first = await createCertification(db, { agency: 'PADI' });
    const second = await createCertification(db, { agency: 'SSI' });

    expect(first.id).not.toBe(second.id);
    expect(first.createdAt).toBe(first.updatedAt);
  });

  /**
   * `storedOptionalCalendarDate` (domain/datetime.ts, §4.1's owner of every `YYYY-MM-DD`),
   * applied at the write boundary — a real date however it was spelled is canonicalised, and a
   * blank is the null the column already uses. `''` stored as-is would sort before every real
   * date and would read on screen as a value that failed to load rather than as a card with no
   * expiry.
   */
  it('canonicalises a loosely spelled date and blanks an empty one', async () => {
    const card = await createCertification(db, {
      issuedOn: '2018-7-4',
      expiresOn: '   ',
    });

    expect(card.issuedOn).toBe('2018-07-04');
    expect(card.expiresOn).toBeNull();
  });

  /**
   * §1: a write boundary never rejects. A date this build cannot read is the diver's and is
   * stored exactly as given — the stance `storedCalendarDate` already takes for a dive's own
   * date, and the reason `formatDiveDate` hands an unreadable value back unchanged.
   */
  it('stores a date it cannot read rather than refusing or inventing one', async () => {
    const card = await createCertification(db, { issuedOn: '2018-02-30' });

    expect(card.issuedOn).toBe('2018-02-30');
  });
});

describe('editing a card', () => {
  it('changes the field it was handed and leaves the others alone', async () => {
    const card = await aCard();

    const edited = await updateCertification(db, card.id, { cardNumber: '7654321' });

    expect(edited.cardNumber).toBe('7654321');
    expect(edited.agency).toBe('PADI');
    expect(edited.course).toBe('Rescue Diver');
    expect(edited.issuedOn).toBe('2018-07-14');
  });

  /**
   * **The `undefined` = don't touch / `null` = clear contract, and both halves matter here in a
   * way they cannot on a preset** (`db/gearPresets.ts`'s two columns are NOT NULL, so nothing
   * there can be cleared). Without the `undefined` half, `{ course: undefined }` — the single
   * most ordinary shape an object literal built from a form produces — would write a real NULL
   * and silently erase a field the caller never mentioned.
   */
  it('leaves a field carried as undefined exactly where it was', async () => {
    const card = await aCard();

    const edited = await updateCertification(db, card.id, {
      cardNumber: '7654321',
      course: undefined,
    });

    expect(edited.course).toBe('Rescue Diver');
  });

  /**
   * **And a patch of nothing BUT carried undefineds is a no-op, clock included** — which is
   * where dropping them earns its place, and it took a mutation to find. Drizzle omits an
   * `undefined` from the SET clause on its own, so the column is left alone either way; what
   * is not left alone is `updated_at`. Undropped, such a key survives the field-by-field
   * comparison (`undefined !== 'Rescue Diver'`), the patch is not empty, and the UPDATE runs
   * with nothing in it but the new stamp — §6's "a device that did nothing must not win
   * against one that did", arriving through the one door the emptiness check does not watch.
   */
  it('treats a patch of nothing but carried undefineds as a no-op, clock included', async () => {
    const card = await aCard();
    await tick();

    const unchanged = await updateCertification(db, card.id, {
      agency: undefined,
      course: undefined,
    });

    expect(unchanged.updatedAt).toBe(card.updatedAt);
    expect(await storedRow(card.id)).toMatchObject({
      updatedAt: card.updatedAt,
      agency: 'PADI',
      course: 'Rescue Diver',
    });
  });

  it('clears a field set to null, which is the other half of that contract', async () => {
    const card = await aCard();

    const edited = await updateCertification(db, card.id, { cardNumber: null });

    expect(edited.cardNumber).toBeNull();
    expect(edited.agency).toBe('PADI');
  });

  /**
   * **A write that changes nothing must not advance `updated_at`** (§6, §7): the device that
   * did nothing would otherwise win the whole-row conflict against the device that did
   * something — a card edited on a phone, silently reverted by a tablet whose owner merely
   * opened it and tapped Save.
   *
   * The patch here is the shape the editor really sends: **all five fields, every time**. An
   * emptiness check like `updateDive`'s would see five keys and write; only a per-field
   * comparison against the stored row can tell this from an edit.
   */
  it('treats a full patch of the values already stored as a no-op', async () => {
    const card = await aCard();
    await tick();

    const unchanged = await updateCertification(db, card.id, {
      agency: 'PADI',
      course: 'Rescue Diver',
      cardNumber: '1234567',
      issuedOn: '2018-07-14',
      expiresOn: null,
    });

    expect(unchanged.updatedAt).toBe(card.updatedAt);
    expect(await storedRow(card.id)).toMatchObject({ updatedAt: card.updatedAt });
  });

  /**
   * And the comparison is over the values **as they will be stored**, so re-saving a date the
   * diver spelled differently is not an edit either. `2018-7-14` and `2018-07-14` are one date;
   * writing one over the other would advance the clock over a row nothing changed about.
   */
  it('treats a loosely respelled date as the same date rather than as an edit', async () => {
    const card = await aCard();
    await tick();

    const unchanged = await updateCertification(db, card.id, { issuedOn: '2018-7-14' });

    expect(unchanged.updatedAt).toBe(card.updatedAt);
  });

  /** A real edit does advance it — the other side of the same rule, so the no-op cases above
   * cannot pass because nothing ever writes. */
  it('advances the clock for an edit that really changes something', async () => {
    const card = await aCard();
    await tick();

    const edited = await updateCertification(db, card.id, { course: 'Divemaster' });

    expect(edited.updatedAt).not.toBe(card.updatedAt);
  });

  /**
   * A key that names no column is dropped by Drizzle's SET builder and the update runs anyway
   * — so a patch of entirely mistyped keys does not merely fail to write, it *succeeds and
   * bumps `updated_at`*, and that row then wins a sync conflict against a genuine edit made on
   * another device. `updateDive` carries the executed version of this.
   */
  it('refuses a key that names no column rather than writing nothing and moving the clock', async () => {
    const card = await aCard();

    await expect(
      updateCertification(db, card.id, { level: 'Rescue' } as unknown as Parameters<
        typeof updateCertification
      >[2]),
    ).rejects.toThrow(/unknown field/);
    expect(await storedRow(card.id)).toMatchObject({ updatedAt: card.updatedAt });
  });

  /** Checked BEFORE undefined keys are dropped: a key that names no column is malformed
   * whatever its value, so `{ level: undefined }` is still a typo worth reporting rather than a
   * "don't touch" instruction about a field that does not exist. */
  it('refuses that key even when it is carried as undefined', async () => {
    const card = await aCard();

    await expect(
      updateCertification(db, card.id, { level: undefined } as unknown as Parameters<
        typeof updateCertification
      >[2]),
    ).rejects.toThrow(/unknown field/);
  });

  it('refuses an id that names nothing live', async () => {
    await expect(updateCertification(db, 'not-a-card', { agency: 'PADI' })).rejects.toThrow(
      /not found/,
    );
  });
});

describe('deleting a card', () => {
  /** Soft, never hard (§6): the tombstone is what carries the deletion to the diver's other
   * devices (§7.2). Every read filters it out, so it leaves the wallet at once. */
  it('tombstones it and takes it out of every read', async () => {
    const card = await aCard();

    await softDeleteCertification(db, card.id);

    expect(await getCertification(db, card.id)).toBeNull();
    expect(await listCertifications(db)).toEqual([]);
    expect(await storedRow(card.id)).toMatchObject({ deletedAt: expect.any(String) as unknown });
  });

  /** "Nothing may silently do nothing" — `softDeleteDive`'s rule. An id that was never real and
   * one that is already tombstoned take the same path: from the live view both are gone. */
  it('refuses an id that names nothing live, deleted ones included', async () => {
    const card = await aCard();
    await softDeleteCertification(db, card.id);

    await expect(softDeleteCertification(db, card.id)).rejects.toThrow(/not found/);
    await expect(softDeleteCertification(db, 'not-a-card')).rejects.toThrow(/not found/);
  });

  it('refuses to edit a card that has been deleted', async () => {
    const card = await aCard();
    await softDeleteCertification(db, card.id);

    await expect(updateCertification(db, card.id, { agency: 'SSI' })).rejects.toThrow(/not found/);
  });
});

describe('reading the wallet', () => {
  /**
   * The order is `compareCertifications`' (domain/certifications.ts) and is applied by the
   * repository, so the awaited read and `useCertifications`' live one cannot disagree. Asserted
   * here rather than only in the domain test because a repository that forgot to sort would
   * return creation order — which looks right for exactly as long as the cards are typed in
   * date order.
   */
  it('reads newest first, with an undated card last', async () => {
    await createCertification(db, { course: 'Open Water', issuedOn: '2014-05-01' });
    await createCertification(db, { course: 'Undated' });
    await createCertification(db, { course: 'Rescue', issuedOn: '2019-08-01' });
    await createCertification(db, { course: 'Advanced', issuedOn: '2016-03-01' });

    expect((await listCertifications(db)).map((card) => card.course)).toEqual([
      'Rescue',
      'Advanced',
      'Open Water',
      'Undated',
    ]);
  });

  /** `toCertifications` sorts what it is given rather than trusting the caller's order, because
   * `useLiveQuery` makes no ordering promise at all — the contract `toDives` and
   * `toGearPresets` both carry. */
  it('sorts rows handed to it out of order', async () => {
    await createCertification(db, { course: 'Open Water', issuedOn: '2014-05-01' });
    await createCertification(db, { course: 'Rescue', issuedOn: '2019-08-01' });
    const rows = await db.select().from(certifications);

    expect(toCertifications([...rows].reverse()).map((card) => card.course)).toEqual([
      'Rescue',
      'Open Water',
    ]);
    // Floored: an empty input would make the line above compare two empty lists.
    expect(rows.length).toBe(2);
  });

  it('reads a wallet with nothing in it as an empty list rather than failing', async () => {
    expect(await listCertifications(db)).toEqual([]);
    expect(await getCertification(db, 'not-a-card')).toBeNull();
  });
});
