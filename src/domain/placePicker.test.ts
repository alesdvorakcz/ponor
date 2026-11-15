import { dive } from './diveFixture';
import { pickerGroups, provenanceOf, type PickerInput, type PickerPlace } from './placePicker';

const place = (over: Partial<PickerPlace> & { id: string }): PickerPlace => ({
  name: over.id,
  country: 'HR',
  latitude: null,
  longitude: null,
  createdBy: null,
  dirty: false,
  ...over,
});

const guest = { signedIn: false, userId: null };
const me = { signedIn: true, userId: 'me' };

const input = (over: Partial<PickerInput> = {}): PickerInput => ({
  kind: 'site',
  places: [],
  dives: [],
  query: '',
  selectedId: null,
  near: null,
  nearSite: null,
  viewer: me,
  ...over,
});

const ids = (group: { rows: { id: string }[] } | undefined) => group?.rows.map((r) => r.id);

describe('pickerGroups', () => {
  it('with nothing typed, lists only places with a logged dive, most recently dived first', () => {
    const places = [place({ id: 'a' }), place({ id: 'b' }), place({ id: 'c' }), place({ id: 'planned' })];
    const dives = [
      dive({ siteId: 'a', date: '2026-01-10' }),
      dive({ siteId: 'b', date: '2026-05-18' }),
      dive({ siteId: 'c', date: '2026-03-01' }),
      dive({ siteId: 'planned', status: 'planned', date: '2026-09-01' }),
    ];
    const groups = pickerGroups(input({ places, dives }));
    expect(groups.map((g) => g.key)).toEqual(['dived']);
    expect(ids(groups[0])).toEqual(['b', 'c', 'a']);
  });

  it("dived rows carry the logbook's counts", () => {
    const dives = [
      dive({ siteId: 's', date: '2026-02-01', maxDepthM: 20 }),
      dive({ siteId: 's', date: '2026-05-18', maxDepthM: 34.6 }),
      dive({ siteId: 's', date: '2026-04-01', maxDepthM: 12 }),
      dive({ siteId: 's', date: '2026-03-01', maxDepthM: null }),
      dive({ siteId: 's', status: 'planned', date: '2026-12-01', maxDepthM: 80 }),
    ];
    const [group] = pickerGroups(input({ places: [place({ id: 's' })], dives }));
    expect(group?.rows[0]?.dived).toEqual({ dives: 4, lastDate: '2026-05-18', deepestM: 34.6, sites: 1 });
  });

  it('a centre row counts the distinct sites dived with it', () => {
    const dives = [
      dive({ centerId: 'c', siteId: 'x' }),
      dive({ centerId: 'c', siteId: 'y' }),
      dive({ centerId: 'c', siteId: 'y' }),
    ];
    const [group] = pickerGroups(input({ kind: 'center', places: [place({ id: 'c' })], dives }));
    expect(group?.rows[0]?.dived).toMatchObject({ dives: 3, sites: 2 });
  });

  it('a row only planned dives point at is not dived', () => {
    const dives = [dive({ siteId: 'p', status: 'planned' })];
    expect(pickerGroups(input({ places: [place({ id: 'p' })], dives }))).toEqual([]);
    const typed = pickerGroups(input({ places: [place({ id: 'p' })], dives, query: 'p' }));
    expect(typed.map((g) => g.key)).toEqual(['other']);
    expect(typed[0]?.rows[0]?.dived).toBeNull();
  });

  it('pairs an unpaired dive to a row by its recorded name, as the rest of the app does', () => {
    const dives = [dive({ siteName: 'Kotelna', siteId: null })];
    const groups = pickerGroups(input({ places: [place({ id: 'k', name: 'Kotelna' })], dives }));
    expect(ids(groups[0])).toEqual(['k']);
  });

  it('typed: dived matches first, then every other matching place at any distance', () => {
    const places = [
      place({ id: 'far', name: 'Vis Reef', latitude: -33, longitude: 151 }),
      place({ id: 'dived', name: 'Vis Wall', latitude: 43, longitude: 16 }),
      place({ id: 'nomatch', name: 'Krk' }),
    ];
    const dives = [dive({ siteId: 'dived' })];
    const groups = pickerGroups(input({ places, dives, query: 'vis' }));
    expect(groups.map((g) => g.key)).toEqual(['dived', 'other']);
    expect(ids(groups[0])).toEqual(['dived']);
    expect(ids(groups[1])).toEqual(['far']);
  });

  it('typed: a dived place that does not match the query is not listed', () => {
    const places = [place({ id: 'a', name: 'Alpha' })];
    const groups = pickerGroups(input({ places, dives: [dive({ siteId: 'a' })], query: 'zzz' }));
    expect(groups).toEqual([]);
  });

  it('orders other places with name-prefix matches first, then the catalogue order', () => {
    const places = [
      place({ id: '1', name: 'Blue Vis' }),
      place({ id: '2', name: 'Vis Wall' }),
      place({ id: '3', name: 'Avis' }),
      place({ id: '4', name: 'Vis Cave' }),
    ];
    const groups = pickerGroups(input({ places, query: 'vis' }));
    expect(ids(groups[0])).toEqual(['4', '2', '3', '1']);
  });

  it('matching folds accents on both sides', () => {
    const places = [place({ id: 'z', name: 'Železná' })];
    expect(ids(pickerGroups(input({ places, query: 'zelezna' }))[0])).toEqual(['z']);
    expect(ids(pickerGroups(input({ places: [place({ id: 'q', name: 'Zelezna' })], query: 'Železná' }))[0])).toEqual([
      'q',
    ]);
  });

  it('lists a catalogue place nobody has dived when its name matches', () => {
    const groups = pickerGroups(input({ places: [place({ id: 'n', name: 'Shark Point' })], query: 'shark' }));
    expect(groups.map((g) => g.key)).toEqual(['other']);
    expect(ids(groups[0])).toEqual(['n']);
  });

  it("an existing place's full name is listed", () => {
    const groups = pickerGroups(input({ places: [place({ id: 'n', name: 'Shark Point' })], query: ' Shark Point ' }));
    expect(ids(groups[0])).toEqual(['n']);
  });

  it('a place created on this phone moments ago is found', () => {
    const fresh = place({ id: 'new', name: 'Brand New Reef', dirty: true, createdBy: null });
    const groups = pickerGroups(input({ places: [fresh], query: 'brand new', viewer: guest }));
    expect(ids(groups[0])).toEqual(['new']);
    expect(groups[0]?.rows[0]?.provenance).toBe('phoneOnly');
  });

  it('skips a malformed row instead of failing the list', () => {
    const places = [null, undefined, place({ id: 'ok', name: 'Okay' })] as unknown as PickerPlace[];
    expect(ids(pickerGroups(input({ places, query: 'ok' }))[0])).toEqual(['ok']);
    expect(pickerGroups(input({ places: null as unknown as PickerPlace[] }))).toEqual([]);
  });

  it('keeps a null name as null on a dived row', () => {
    const groups = pickerGroups(input({ places: [place({ id: 'u', name: null })], dives: [dive({ siteId: 'u' })] }));
    expect(groups[0]?.rows[0]?.name).toBeNull();
  });

  describe('Near me', () => {
    const fix = { latitude: 43.0, longitude: 16.0 };
    const places = [
      place({ id: 'mid', name: 'Vis Mid', latitude: 43.2, longitude: 16.0 }), // ~22 km
      place({ id: 'close', name: 'Vis Close', latitude: 43.05, longitude: 16.0 }), // ~5.5 km
      place({ id: 'far', name: 'Vis Far', latitude: 44.0, longitude: 16.0 }), // ~111 km
      place({ id: 'nopos', name: 'Vis Nowhere' }),
      place({ id: 'other', name: 'Krk Close', latitude: 43.01, longitude: 16.0 }),
    ];

    it('is one near group within 50 km, nearest first, dived or not, with places lacking a position left out', () => {
      const groups = pickerGroups(input({ places, near: fix, dives: [dive({ siteId: 'mid' })] }));
      expect(groups.map((g) => g.key)).toEqual(['near']);
      expect(ids(groups[0])).toEqual(['other', 'close', 'mid']);
      const mid = groups[0]?.rows.find((r) => r.id === 'mid');
      expect(mid?.dived).not.toBeNull();
      expect(mid?.distanceKm).toBeGreaterThan(21);
      expect(mid?.distanceKm).toBeLessThan(23);
    });

    it('the query still filters', () => {
      const groups = pickerGroups(input({ places, near: fix, query: 'vis' }));
      expect(ids(groups[0])).toEqual(['close', 'mid']);
    });

    it('is empty when nothing is in range', () => {
      expect(pickerGroups(input({ places, near: fix, query: 'far' }))).toEqual([]);
    });

    it('leaves distance null outside the near groups', () => {
      const groups = pickerGroups(input({ places, query: 'vis' }));
      expect(groups[0]?.rows.every((r) => r.distanceKm === null)).toBe(true);
    });
  });

  describe('centre near its site', () => {
    const site = { latitude: 43.0, longitude: 16.0 };
    const centers = [
      place({ id: 'dived', name: 'Dived Shop', latitude: 43.01, longitude: 16.0 }),
      place({ id: 'near2', name: 'B Shop', latitude: 43.04, longitude: 16.0 }),
      place({ id: 'near1', name: 'A Shop', latitude: 43.02, longitude: 16.0 }),
      place({ id: 'far', name: 'Far Shop', latitude: 43.5, longitude: 16.0 }),
      place({ id: 'mine', name: 'My Shop', latitude: 43.0, longitude: 16.0, createdBy: 'me' }),
      place({ id: 'phone', name: 'Phone Shop', latitude: 43.0, longitude: 16.0, dirty: true }),
      place({ id: 'nopos', name: 'No Pos Shop' }),
    ];
    const dives = [dive({ centerId: 'dived' })];

    it("'nearSite' lists community centres within 10 km by distance and leaves out ones already in 'dived'", () => {
      const groups = pickerGroups(input({ kind: 'center', places: centers, dives, nearSite: site }));
      expect(groups.map((g) => g.key)).toEqual(['dived', 'nearSite']);
      expect(ids(groups[0])).toEqual(['dived']);
      expect(ids(groups[1])).toEqual(['near1', 'near2']);
      expect(groups[1]?.rows[0]?.distanceKm).toBeCloseTo(2.2, 1);
    });

    it('is not offered once something is typed, and never for a site picker', () => {
      const typed = pickerGroups(input({ kind: 'center', places: centers, nearSite: site, query: 'shop' }));
      expect(typed.map((g) => g.key)).toEqual(['other']);
      const forSite = pickerGroups(input({ kind: 'site', places: centers, nearSite: site }));
      expect(forSite).toEqual([]);
    });

    it('Near me takes the list over', () => {
      const groups = pickerGroups(
        input({ kind: 'center', places: centers, dives, nearSite: site, near: { latitude: 43.0, longitude: 16.0 } }),
      );
      expect(groups.map((g) => g.key)).toEqual(['near']);
    });
  });

  describe('the selected place', () => {
    it('is marked wherever it appears', () => {
      const places = [place({ id: 's', name: 'Vis' })];
      const dives = [dive({ siteId: 's' })];
      const nothing = pickerGroups(input({ places, dives, selectedId: 's' }));
      expect(nothing[0]?.rows[0]?.selected).toBe(true);
      const typed = pickerGroups(input({ places: [place({ id: 's', name: 'Vis' })], selectedId: 's', query: 'vi' }));
      expect(typed[0]?.rows[0]?.selected).toBe(true);
      const other = pickerGroups(input({ places: [place({ id: 't', name: 'Vis' })], selectedId: 's', query: 'vi' }));
      expect(other[0]?.rows[0]?.selected).toBe(false);
    });

    it('is not added to a group it does not belong to', () => {
      const places = [place({ id: 'fresh', name: 'Fresh' })];
      expect(pickerGroups(input({ places, selectedId: 'fresh' }))).toEqual([]);
      expect(pickerGroups(input({ places, selectedId: 'fresh', query: 'zzz' }))).toEqual([]);
    });
  });

  it('omits empty groups', () => {
    const places = [place({ id: 'a', name: 'Alpha' })];
    expect(pickerGroups(input({ places, query: 'alp' })).map((g) => g.key)).toEqual(['other']);
    expect(pickerGroups(input({ places }))).toEqual([]);
  });
});

describe('provenanceOf', () => {
  it('signed in: your own and your pending rows are yours, the rest community', () => {
    expect(provenanceOf(place({ id: 'a', createdBy: 'me' }), me)).toBe('yours');
    expect(provenanceOf(place({ id: 'a', dirty: true }), me)).toBe('yours');
    expect(provenanceOf(place({ id: 'a', createdBy: 'someone' }), me)).toBe('community');
  });

  it('guest: a pending row is on this phone only, the rest community', () => {
    expect(provenanceOf(place({ id: 'a', dirty: true }), guest)).toBe('phoneOnly');
    expect(provenanceOf(place({ id: 'a', createdBy: 'someone' }), guest)).toBe('community');
  });

  it('a signed-in viewer with no user id never matches a null creator', () => {
    expect(provenanceOf(place({ id: 'a', createdBy: null }), { signedIn: true, userId: null })).toBe('community');
  });
});
