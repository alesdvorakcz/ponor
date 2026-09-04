import { calendarDateToUtcMs } from './datetime';
import type { Certification } from './types';

/**
 * The rules a certification card (DESIGN.md §3, §6) obeys that are not about storing one:
 * what order a wallet is read in, whether a card has run out, and what refuses a save.
 *
 * **Here rather than in `db/certifications.ts`**, on `domain/presets.ts`' own precedent one
 * object over: `db/` is the repository layer, and every rule below is asked by a *screen* —
 * the wallet list orders itself, the editor decides whether to write. A screen reaching into
 * the database layer for a pure comparison inverts the dependency for functions that never
 * touch a row.
 *
 * **What is deliberately NOT here: a list of agencies.** §6 writes `PADI·SSI·CMAS·…` and the
 * ellipsis is doing the work — BSAC, NAUI, SDI/TDI, RAID, GUE, IANTD, PSAI, FFESSM, AIDA,
 * Molchanovs and a long tail after them. Three arguments, and the third is the one that
 * settles it:
 *
 * · `domain/types.ts` owns "every closed vocabulary a form offers as a fixed list" (§4.1), so
 *   an agency list would have to live there and would make that file assert something false.
 * · §2.3's own pattern for an open set is *suggest from history, accept anything*, and it does
 *   not fit either: a wallet holds a handful of cards over a lifetime, so "agencies you have
 *   typed before" is a list of one by the time it could help. `domain/suggest.ts` says to
 *   split it if a third kind of answer arrives rather than widen it, and this is not even a
 *   second kind of the same question.
 * · §10's store-and-flag ruling is the argument *against* a vocabulary here rather than for
 *   one. Its last clause is explicit that a flag attributing a strange value to another build
 *   is false for "the only fields in the app where the diver could have typed it himself" —
 *   and an agency is exactly that. A closed list would make a BSAC diver's own correct answer
 *   wear a note saying this build does not recognise it.
 *
 * So `agency` and `course` are free text, and this module holds no vocabulary at all.
 */

/**
 * What a card with nothing in it is refused with.
 *
 * **§1 binds a dive, and a save this refuses is not a dive** — the same distinction
 * `presetRefusal` (domain/presets.ts) already draws, and `setDivesBefore` before it. Nothing
 * here is on the path between a diver surfacing and their dive being logged; a wallet row is
 * written once, on dry land, from a plastic card in hand.
 *
 * And it refuses exactly one thing: a card holding **no field at all**. Everything else is
 * saved as given, including an expiry earlier than the issue date — that is §10's "a warning
 * or a correction, never a rejection", and the app has no business telling a diver their own
 * card is impossible. What a wholly empty row would be is not data at all: a wallet entry
 * with no agency, no course, no number and no dates is a row that cannot be told from the
 * next empty one, cannot be searched for, and gives the diver nothing to correct.
 */
export const EMPTY_CERTIFICATION_NOTE =
  'Add at least one detail — the agency, the course, a card number or a date.';

/** The five fields a diver fills in. The stamps and the flag are the repository's (§7.1). */
export type CertificationFields = Pick<
  Certification,
  'agency' | 'course' | 'cardNumber' | 'issuedOn' | 'expiresOn'
>;

/** Every one of them, derived from the type rather than listed, so a sixth field added to
 * `Certification` cannot be silently left out of the refusal below or of the editor's own
 * seeding. `satisfies` is what ties the two together: drop a key and this stops compiling. */
export const CERTIFICATION_FIELDS = [
  'agency',
  'course',
  'cardNumber',
  'issuedOn',
  'expiresOn',
] as const satisfies readonly (keyof CertificationFields)[];

/**
 * What the editor is allowed to write, and whether it may write at all.
 *
 * `presetRefusal`'s shape (domain/presets.ts): the verdict, the sentence, and the values as
 * they would actually be stored — so the screen decides *where* to say it and nothing else.
 */
export interface CertificationRefusal {
  readonly refused: boolean;
  /** The sentence, or null when there is nothing to say. */
  readonly note: string | null;
  /** The fields as they should be stored: trimmed, and blank means absent. */
  readonly stored: CertificationFields;
}

/**
 * A text field as it is stored: trimmed, with blank meaning **absent** rather than empty.
 *
 * An untouched `FormField` hands back `''`, and `''` stored as-is is a second spelling of
 * "nothing recorded" that every reader would then have to handle — §6's own argument for why
 * `tanks` is NOT NULL, pointed the other way. It is applied here rather than in the
 * repository for the reason `db/dives.ts` leaves `buddy` and `notes` alone: blanking a text
 * box is a *form* boundary, and `diveFormSchema`'s `optionalText` is the same rule for the
 * form that has a schema. The two DATE fields are the repository's, because
 * `domain/datetime.ts` owns what a stored date is however it arrives (§4.1).
 */
function storedText(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

export function certificationRefusal(fields: CertificationFields): CertificationRefusal {
  const stored: CertificationFields = {
    agency: storedText(fields.agency),
    course: storedText(fields.course),
    cardNumber: storedText(fields.cardNumber),
    // The dates are trimmed and blanked here too, so that "is this card empty" is asked of
    // the same five values that would be written. Canonicalising them is `db/certifications.ts`'
    // job through `storedOptionalCalendarDate`, and it agrees with this on the blank case.
    issuedOn: storedText(fields.issuedOn),
    expiresOn: storedText(fields.expiresOn),
  };

  // Read over `CERTIFICATION_FIELDS` rather than as five `&&`s, so a sixth field is covered
  // by the commit that adds it instead of quietly not counting.
  const empty = CERTIFICATION_FIELDS.every((field) => stored[field] === null);
  return {
    refused: empty,
    note: empty ? EMPTY_CERTIFICATION_NOTE : null,
    stored,
  };
}

/**
 * Whether a card has run out, or `null` when that is not a question about this card.
 *
 * **Null is three different situations and they are deliberately one answer here**: the card
 * carries no expiry (most do not — §6 names "(O₂, first aid)" as the kinds that do, so a null
 * column means *this card does not expire* rather than *nobody has typed it yet*), or the
 * stored value names no real date, or today does not. In every one of them the honest thing
 * to draw is nothing, and a screen with no answer must not state one (M1f).
 *
 * **A card expiring today is current.** A certification is valid through its printed date, so
 * the comparison is over whole calendar days and the boundary belongs to the diver.
 * `calendarDateToUtcMs` (domain/datetime.ts) is what makes that comparison honest: both sides
 * are calendar dates rather than instants, so no time zone can move one of them across
 * midnight relative to the other — which is the failure §7.3 already records about clocks and
 * §4.1 gives that module the ownership of.
 */
export type ExpiryState = 'current' | 'expired';

export function certificationExpiry(expiresOn: string | null, today: string): ExpiryState | null {
  const expires = calendarDateToUtcMs(expiresOn);
  const now = calendarDateToUtcMs(today);
  if (expires === null || now === null) return null;
  return expires < now ? 'expired' : 'current';
}

/**
 * **A wallet reads newest first**, by the date on the card, and that is the same order §3
 * already gives the logbook: the most recent qualification is the one a diver is looking for,
 * and it is the one an instructor or a shop asks to see.
 *
 * Two rejected alternatives, recorded so they are not re-proposed:
 *
 * *Alphabetically by course*, which is what `comparePresets` does one module over and is
 * wrong here for the reason that one is right there. A preset's name is a label the diver
 * chose and scans by; a wallet is a sequence — Open Water, Advanced, Nitrox, Rescue — and
 * alphabetical order scrambles a progression into "Advanced, Nitrox, Open Water, Rescue".
 *
 * *Creation order*, which is what the rows come back in and therefore what a missing
 * comparator silently produces — the reason this is asserted directly rather than in passing.
 * It puts the card the diver happened to type first at the top for ever, which is a fact
 * about an evening of data entry rather than about the diver.
 *
 * **A card with no issue date sorts last, not first.** `issuedOn` is nullable and a missing
 * date is *unknown*, not *ancient*: sorting nulls as the epoch would bury a card the diver
 * simply did not date, and sorting them as today would float it above cards that really are
 * newer. Last, together, is the only position that claims nothing.
 *
 * `createdAt` breaks every remaining tie, so a wallet whose cards share a date — or have none
 * — has one stable order rather than whichever the sort happened to settle on.
 */
export function compareCertifications(a: Certification, b: Certification): number {
  const left = calendarDateToUtcMs(a.issuedOn);
  const right = calendarDateToUtcMs(b.issuedOn);
  if (left !== right) {
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left;
  }
  return a.createdAt.localeCompare(b.createdAt);
}
