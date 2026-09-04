import {
  CERTIFICATION_FIELDS,
  certificationExpiry,
  certificationRefusal,
  compareCertifications,
  EMPTY_CERTIFICATION_NOTE,
  type CertificationFields,
} from './certifications';
import type { Certification } from './types';

/**
 * **The three rules a certification obeys that are not about storing one** (DESIGN.md §3, §6).
 *
 * Each fails quietly if it goes: a wallet in creation order looks fine until the diver types
 * their cards in the wrong sequence; an expiry that reads a date wrong tells someone their O₂
 * card is good when it is not; a refusal that fires on the wrong shape either fills the list
 * with blank rows or turns a diver's real card away.
 */

let seq = 0;
const card = (over: Partial<Certification> = {}): Certification => ({
  id: `cert-${String(seq++).padStart(4, '0')}`,
  agency: null,
  course: null,
  cardNumber: null,
  issuedOn: null,
  expiresOn: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  deletedAt: null,
  dirty: false,
  ...over,
});

const fields = (over: Partial<CertificationFields> = {}): CertificationFields => ({
  agency: null,
  course: null,
  cardNumber: null,
  issuedOn: null,
  expiresOn: null,
  ...over,
});

describe('what refuses a save', () => {
  /**
   * The one thing refused, and the reason it is not §1's business: nothing here is on the path
   * between a diver surfacing and their dive being logged. A row with no agency, no course, no
   * number and no dates cannot be told from the next empty one and gives the diver nothing to
   * correct.
   */
  it('refuses a card holding nothing at all, and says so', () => {
    const refusal = certificationRefusal(fields());

    expect(refusal.refused).toBe(true);
    expect(refusal.note).toBe(EMPTY_CERTIFICATION_NOTE);
  });

  /** Blank text is nothing, so a card of spaces is a card of nothing — this is where `''` stops
   * being a second spelling of "not recorded" that every reader would have to handle. */
  it('refuses a card whose every field is blank or whitespace', () => {
    expect(certificationRefusal(fields({ agency: '   ', course: '', cardNumber: ' ' })).refused).toBe(
      true,
    );
  });

  /**
   * **Any one field is enough**, checked field by field rather than on a sample: a refusal that
   * happened to look at only `agency` would turn away a diver who typed a course, and would
   * pass a test that only ever gave it an agency. The list is `CERTIFICATION_FIELDS`, so a
   * sixth field is covered by the commit that adds it.
   */
  it.each(CERTIFICATION_FIELDS)('accepts a card holding only %s', (field) => {
    const refusal = certificationRefusal(fields({ [field]: '2019-06-01' }));

    expect(`${field}: ${String(refusal.refused)}`).toBe(`${field}: false`);
    expect(refusal.note).toBeNull();
  });

  it('names every field of the type, so a sixth cannot be left out of that sweep', () => {
    expect([...CERTIFICATION_FIELDS].sort()).toEqual([
      'agency',
      'cardNumber',
      'course',
      'expiresOn',
      'issuedOn',
    ]);
  });

  it('hands back the values trimmed, with a blank meaning absent', () => {
    const refusal = certificationRefusal(
      fields({ agency: '  PADI  ', course: '', cardNumber: ' 1234567 ' }),
    );

    expect(refusal.stored).toEqual({
      agency: 'PADI',
      course: null,
      cardNumber: '1234567',
      issuedOn: null,
      expiresOn: null,
    });
  });

  /**
   * §10: "a warning or a correction, never a rejection". An expiry before the issue date is
   * odd and it is the diver's own card; refusing it would be the app telling them their
   * plastic is wrong, and there is nothing they could do about it here.
   */
  it('does not refuse an expiry earlier than the issue date', () => {
    expect(
      certificationRefusal(fields({ issuedOn: '2019-06-01', expiresOn: '2015-06-01' })).refused,
    ).toBe(false);
  });

  /** And a value it cannot read is still a value: §1 does not let this reject, and nothing here
   * decides what a date means — `domain/datetime.ts` does, at the repository. */
  it('does not refuse a date it cannot read', () => {
    expect(certificationRefusal(fields({ issuedOn: 'last summer' })).refused).toBe(false);
  });
});

describe('whether a card has run out', () => {
  const TODAY = '2026-09-04';

  it('reads a date in the past as expired', () => {
    expect(certificationExpiry('2024-03-03', TODAY)).toBe('expired');
  });

  it('reads a date in the future as current', () => {
    expect(certificationExpiry('2027-03-03', TODAY)).toBe('current');
  });

  /** A certification is valid through its printed date, so the boundary belongs to the diver.
   * Off by one here is a card reported dead on the last day it works. */
  it('reads a card expiring today as current, not expired', () => {
    expect(certificationExpiry(TODAY, TODAY)).toBe('current');
  });

  it('reads the day after as expired, so the boundary is where it is claimed to be', () => {
    expect(certificationExpiry('2026-09-03', TODAY)).toBe('expired');
  });

  /**
   * Three situations, one answer, and it is `null` on purpose (M1f: a screen with no answer
   * must not state one). Most cards never expire — §6 names "(O₂, first aid)" as the kinds that
   * do — so a null column means *this card does not expire*, not *nobody has typed it yet*.
   */
  it('says nothing about a card with no expiry, or about a date it cannot read', () => {
    expect(certificationExpiry(null, TODAY)).toBeNull();
    expect(certificationExpiry('', TODAY)).toBeNull();
    expect(certificationExpiry('last summer', TODAY)).toBeNull();
    expect(certificationExpiry('2026-02-30', TODAY)).toBeNull();
    expect(certificationExpiry('2027-03-03', 'not a day')).toBeNull();
  });

  /*
   * **The zone is not tested here, and that is deliberate rather than a gap.** The comparison
   * is over calendar dates rather than instants — `calendarDateToUtcMs` (domain/datetime.ts) —
   * which is what stops a device's own zone moving one side of it across midnight relative to
   * the other. A test of that written in this file would be a guard that cannot fail:
   * `datetime.utc-plus-14.test.ts`'s docblock records that setting `process.env.TZ` from
   * inside a test does nothing at all, because Jest sandboxes `process`, and CI runs in UTC
   * where a naive implementation passes too. The zone is forced by a jest environment instead,
   * in `certifications.utc-plus-14.test.ts` beside this file.
   */
});

describe('the order a wallet reads in', () => {
  /** Newest first, the order §3 already gives the logbook: the most recent qualification is the
   * one a diver is looking for and the one a shop asks to see. */
  it('puts the most recently issued card first', () => {
    const cards = [
      card({ course: 'Open Water', issuedOn: '2014-05-01' }),
      card({ course: 'Rescue', issuedOn: '2019-08-01' }),
      card({ course: 'Advanced', issuedOn: '2016-03-01' }),
    ];

    expect([...cards].sort(compareCertifications).map((entry) => entry.course)).toEqual([
      'Rescue',
      'Advanced',
      'Open Water',
    ]);
  });

  /**
   * **A card with no issue date sorts last, not first.** A missing date is *unknown*, not
   * *ancient*: treated as the epoch it would bury a card the diver simply did not date, and
   * treated as today it would float above cards that really are newer.
   */
  it('puts an undated card last, whichever end of the list it started at', () => {
    const dated = card({ course: 'Rescue', issuedOn: '2019-08-01' });
    const undated = card({ course: 'Undated' });

    expect([undated, dated].sort(compareCertifications).map((entry) => entry.course)).toEqual([
      'Rescue',
      'Undated',
    ]);
    expect([dated, undated].sort(compareCertifications).map((entry) => entry.course)).toEqual([
      'Rescue',
      'Undated',
    ]);
  });

  /** `createdAt` breaks every remaining tie, so a wallet whose cards share a date — or have
   * none — has one order rather than whichever the sort happened to settle on. */
  it('breaks a tie on createdAt, for dated and undated cards alike', () => {
    const first = card({ course: 'A', issuedOn: '2019-08-01', createdAt: '2026-01-01T00:00:00.000Z' });
    const second = card({ course: 'B', issuedOn: '2019-08-01', createdAt: '2026-02-01T00:00:00.000Z' });
    const thirdUndated = card({ course: 'C', createdAt: '2026-01-01T00:00:00.000Z' });
    const fourthUndated = card({ course: 'D', createdAt: '2026-02-01T00:00:00.000Z' });

    expect(
      [second, fourthUndated, thirdUndated, first].sort(compareCertifications).map((e) => e.course),
    ).toEqual(['A', 'B', 'C', 'D']);
  });

  /** A date this build cannot read is not a date, so such a card joins the undated ones rather
   * than sorting somewhere arbitrary by string. */
  it('treats a date it cannot read the way it treats no date at all', () => {
    const unreadable = card({ course: 'Nonsense', issuedOn: '2019-02-30' });
    const dated = card({ course: 'Rescue', issuedOn: '2010-01-01' });

    expect([unreadable, dated].sort(compareCertifications).map((entry) => entry.course)).toEqual([
      'Rescue',
      'Nonsense',
    ]);
  });
});
