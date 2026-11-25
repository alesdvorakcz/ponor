import { dive } from './diveFixture';
import { pickerGroups, type PickerInput, type PickerPlace, type PlaceKind } from './placePicker';
import { type Dive } from './types';

/**
 * **What the picker costs per keystroke, as a count rather than a clock** (#36).
 *
 * The picker pairs catalogue rows with the logbook on every keystroke. It used to walk the whole
 * logbook once per row — 5,000 sites and 1,000 dives measured 5.4 s per update on a simulator —
 * and now sorts the logbook once into a lookup and reuses it while the query changes. A timing
 * test would be flaky, so this counts how often each dive's pairing column is read instead: the
 * dives below point at ids no row has, so nothing but pairing ever reads them.
 *
 * Which rows land in which group is `placePicker.test.ts`' claim, and that file is unchanged by
 * #36 on purpose.
 */

const PLACES = 50;
const DIVES = 20;

const places: PickerPlace[] = Array.from({ length: PLACES }, (_, i) => ({
  id: `p${i}`,
  name: `Place ${i}`,
  country: 'CZ',
  latitude: null,
  longitude: null,
  createdBy: null,
  dirty: false,
}));

/** Dives paired to ids the catalogue lacks, each counting reads of the kind's id column. */
function countedLogbook(kind: PlaceKind): { dives: Dive[]; reads: () => number } {
  let reads = 0;
  const column = kind === 'site' ? 'siteId' : 'centerId';
  const dives = Array.from({ length: DIVES }, (_, i) => {
    const d = dive();
    Object.defineProperty(d, column, {
      get() {
        reads += 1;
        return `absent-${i}`;
      },
    });
    return d;
  });
  return { dives, reads: () => reads };
}

const base = (kind: PlaceKind, dives: readonly Dive[]): PickerInput => ({
  kind,
  places,
  dives,
  query: '',
  selectedId: null,
  near: null,
  nearSite: null,
  viewer: { signedIn: false, userId: null },
});

it.each(['site', 'center'] as const)('reads each dive’s pairing once per logbook, not once per %s row', (kind) => {
  const { dives, reads } = countedLogbook(kind);
  pickerGroups(base(kind, dives));
  expect(reads()).toBeLessThanOrEqual(DIVES);
});

it.each(['site', 'center'] as const)('reuses the pairing while the %s query changes', (kind) => {
  const { dives, reads } = countedLogbook(kind);
  pickerGroups(base(kind, dives));
  const after = reads();
  pickerGroups({ ...base(kind, dives), query: 'pl' });
  pickerGroups({ ...base(kind, dives), query: 'place 1' });
  expect(reads()).toBe(after);
});

// Review Focus 1: a dive saved while the picker is open arrives as a new logbook array, and the
// pairing kept for the old one must not answer for it.
it.each(['site', 'center'] as const)('sees a dive logged while the %s picker is open', (kind) => {
  const { dives } = countedLogbook(kind);
  expect(pickerGroups(base(kind, dives)).find((g) => g.key === 'dived')).toBeUndefined();
  const there = kind === 'site' ? dive({ siteId: 'p0' }) : dive({ centerId: 'p0' });
  const groups = pickerGroups(base(kind, [...dives, there]));
  expect(groups.find((g) => g.key === 'dived')?.rows.map((r) => r.id)).toEqual(['p0']);
});
