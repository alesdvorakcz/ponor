// The package's own official Jest mock, imported first and named `mock…` for the
// babel-plugin-jest-hoist reason `DivesScreen.test.tsx` records: a `jest.mock()` factory may
// only close over out-of-scope identifiers starting with `mock`/`require`, and every
// `jest.mock()` call is hoisted above every import regardless. This screen's root composes
// `screenTopInset(insets.top)` like every other, and the real hook throws without a Provider.
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { act, render, type RenderResult } from '@testing-library/react-native';

import { useDives, type DiveListState } from '../db/useDives';
import { useDiveSites, type DiveSiteListState } from '../db/useDiveSites';
import { useUnitSystem } from '../db/useUnitSystem';
import { localDateToCalendarDate } from '../domain/datetime';
import { dive } from '../domain/diveFixture';
import { assignDiveNumbers } from '../domain/diveNumber';
import { logbookStats } from '../domain/logbookStats';
import { type Dive, type DiveSite, type Tank } from '../domain/types';
import { formatLogbookSummary } from '../format/display';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { depthScale } from '../theme/tokens';
import { makeStyles, RMV_SPARK_STEPS, screenBottomInset } from '../theme/styles';
import { LOGBOOK_UNREADABLE } from '../domain/logbook';
import StatsScreen, {
  COUNTRIES_UNKNOWN_NOTE,
  NOTHING_LOGGED_MESSAGE,
  NO_FIGURE,
  ONLY_PLANNED_MESSAGE,
  REFRESHER_MESSAGE,
} from './StatsScreen';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
jest.mock('../db/useDiveSites', () => ({ useDiveSites: jest.fn() }));
jest.mock('../db/useUnitSystem', () => ({ useUnitSystem: jest.fn(() => 'metric') }));

const mockUseDives = useDives as jest.MockedFunction<typeof useDives>;
const mockUseDiveSites = useDiveSites as jest.MockedFunction<typeof useDiveSites>;
const mockUseUnitSystem = useUnitSystem as jest.MockedFunction<typeof useUnitSystem>;

/** The dive read, in the state a screen normally meets it: resolved, no failure, real numbers
 * from the real numbering rule rather than hand-written ones (§2.5 computes them). */
function divesState(dives: Dive[], over: Partial<DiveListState> = {}): DiveListState {
  return {
    dives,
    numbers: assignDiveNumbers(dives, 0),
    resolved: true,
    error: undefined,
    settingsError: undefined,
    ...over,
  };
}

function catalogueState(sites: DiveSite[], over: Partial<DiveSiteListState> = {}): DiveSiteListState {
  return { sites, resolved: true, error: undefined, ...over };
}

let siteSeq = 0;
const site = (over: Partial<DiveSite> = {}): DiveSite => ({
  id: `site-${String(siteSeq++).padStart(4, '0')}`,
  name: null,
  country: null,
  latitude: null,
  longitude: null,
  salinity: null,
  waterBody: null,
  entry: null,
  maxDepthM: null,
  createdBy: null,
  status: 'active',
  mergedInto: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  deletedAt: null,
  dirty: false,
  ...over,
});

/**
 * A calendar date `n` days before today, read through the same conversion `todayCalendarDate`
 * uses — never a fixed string, because this screen asks the real clock what day it is and a
 * literal here would rot the moment the calendar moved past it.
 */
function daysAgo(n: number): string {
  const when = new Date();
  when.setDate(when.getDate() - n);
  return localDateToCalendarDate(when) ?? '';
}

/** A dive breathing exactly `litresPerMin`: a 10 l single, 10 m average (2 ata), 50 minutes, so
 * a used pressure of `10 × R` bar gives `R` l/min (`rmv`, domain/derived.ts). */
const gasDive = (litresPerMin: number, over: Partial<Dive> = {}): Dive => {
  const tank: Tank = {
    material: null,
    configuration: 'single',
    sizeL: 10,
    workingBar: null,
    o2Pct: null,
    hePct: null,
    startBar: 200,
    endBar: 200 - litresPerMin * 10,
  };
  return dive({ avgDepthM: 10, durationMin: 50, tanks: [tank], ...over });
};

beforeEach(() => {
  mockUseDives.mockReturnValue(divesState([]));
  mockUseDiveSites.mockReturnValue(catalogueState([]));
  mockUseUnitSystem.mockReturnValue('metric');
});

/**
 * Renders and lets the frame settle before anything is asserted — the same `show()`
 * `MapScreen.test.tsx` uses, and for the reason its own note gives: no assertion should run
 * against a frame the screen has already moved past, and no `act()` warning should be printed
 * after a test has passed.
 *
 * **Called exactly once per test, and that is a rule rather than a habit.** An earlier draft
 * rendered several states in one `it` with an `unmount()` between them; React's act scopes
 * overlapped, the third render came back with an **empty tree**, and every assertion against it
 * passed or failed for reasons that had nothing to do with the screen — three of them were
 * vacuously green. Every test below therefore renders once, and the cases that want two
 * logbooks compared are written as two tests or as one expected object.
 */
async function show(): Promise<RenderResult> {
  const t = await render(<StatsScreen />);
  await act(async () => {});
  return t;
}

function allNodes(t: RenderResult) {
  return t.root ? [t.root, ...t.root.queryAll(() => true)] : [];
}

function textIn(t: RenderResult): string[] {
  return allNodes(t)
    .filter((n) => n.type === 'Text')
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

/**
 * Every counter on the screen, as `label -> figure`.
 *
 * Read off `formFieldRow` — the row style this screen shares with the form and Settings (§0.6:
 * "a field is a row, not a box") — rather than off a test id, so a screen that stopped using
 * the shared row and drew a card of its own would find no counters here at all, which is the
 * §0.6 rule this test can actually see.
 */
function counters(t: RenderResult): Record<string, string> {
  const styles = makeStyles('light');
  const rows = allNodes(t).filter((n) => [n.props?.style].flat(5).includes(styles.formFieldRow));
  const found: Record<string, string> = {};
  for (const row of rows) {
    const texts = [row, ...row.queryAll(() => true)]
      .filter((n) => n.type === 'Text')
      .flatMap((n) => n.children)
      .filter((c): c is string => typeof c === 'string');
    const [label, value] = texts;
    if (label !== undefined) found[label] = value ?? '';
  }
  return found;
}

/**
 * **The RMV sparkline, read as numbers — and read from inside the RMV row itself.**
 *
 * Every bar's height in cells, in the order drawn, found by walking down from the row whose
 * label is `RMV` rather than by sweeping the screen for cells. That is the §0.6 assertion this
 * helper can actually make: the bars are *a shape beside a number*, so a sparkline that grew
 * into a block of its own — the card §0.6's brief for this screen asked it not to invent —
 * would be found by no test below rather than passing them all in a new place.
 */
function rmvBars(t: RenderResult): number[] {
  const styles = makeStyles('light');
  const row = allNodes(t)
    .filter((n) => [n.props?.style].flat(5).includes(styles.formFieldRow))
    .find(
      (candidate) =>
        [candidate, ...candidate.queryAll(() => true)]
          .filter((n) => n.type === 'Text')
          .flatMap((n) => n.children)
          .filter((c): c is string => typeof c === 'string')[0] === 'RMV',
    );
  if (!row) return [];
  return row
    .queryAll((n) => n.type === 'View' && [n.props?.style].flat(5).includes(styles.rmvSparkBar))
    .map(
      (bar) =>
        bar.queryAll((n) => n.type === 'View' && [n.props?.style].flat(5).includes(styles.rmvSparkCell))
          .length,
    );
}

/** Every `color` any style on the screen sets — the sweep §0.1 needs on `Text`, which
 * `unexpectedGraphics` deliberately never inspects (it guards painted `View`s). */
function inkColours(t: RenderResult): string[] {
  return allNodes(t)
    .flatMap((n) => [n.props?.style].flat(5))
    .filter((entry): entry is { color?: unknown } => typeof entry === 'object' && entry !== null)
    .map((entry) => entry.color)
    .filter((value): value is string => typeof value === 'string');
}

/** Eight dives at five places, one of them spelled two ways, in two countries — the shape the
 * simulator's own logbook has, so what these tests assert is what the owner sees. */
function logbook(): Dive[] {
  return [
    dive({ date: daysAgo(9), siteName: 'Kotelna', durationMin: 44, maxDepthM: 12.2 }),
    dive({ date: daysAgo(8), siteName: 'kotelna', durationMin: 51, maxDepthM: 18.4 }),
    dive({ date: daysAgo(7), siteId: 'site-hr', siteName: 'Vis', durationMin: 37, maxDepthM: 31.4 }),
    dive({ date: daysAgo(6), siteId: 'site-hr', siteName: 'Vis wall', durationMin: 40, maxDepthM: 41.2 }),
    dive({ date: daysAgo(5), siteName: 'Blue Hole', durationMin: 48, maxDepthM: 24.0 }),
    dive({ date: daysAgo(4), siteId: 'site-eg', siteName: 'Bells', durationMin: 39, maxDepthM: 28.5 }),
    dive({ date: daysAgo(3), siteName: 'Šárka', durationMin: 33, maxDepthM: 9.4 }),
    dive({ date: daysAgo(2), siteName: 'Sarka', durationMin: 45, maxDepthM: 15.0 }),
  ];
}

// --- The four states this screen can be in, and the two that must not state an answer ---

// The title is drawn on every branch, in the same words and the same place, so nothing moves
// when the figures — or the message, or nothing — land beneath it. One render per case rather
// than a loop inside one test: a second `render()` in one test leaves React's act scope
// overlapping under this setup, and the third came back with an empty tree (measured — it is
// what made every assertion in an earlier draft of this file vacuously green).
it.each([
  ['a failed read', () => divesState([], { error: new Error('disk') })],
  ['a read that has not answered', () => divesState([], { resolved: false })],
  ['an empty logbook', () => divesState([])],
  ['a logbook with dives in it', () => divesState(logbook())],
] as const)('names itself on %s', async (_label, state) => {
  mockUseDives.mockReturnValue(state());
  expect(textIn(await show())).toContain('Stats');
});

it('reports a failed logbook read rather than a screen of noughts', async () => {
  mockUseDives.mockReturnValue(divesState([], { error: new Error('disk') }));
  const t = await show();
  expect(textIn(t).join(' ')).toContain(LOGBOOK_UNREADABLE);
  // Not the empty-logbook sentence, and no figures either: a read that failed knows nothing
  // about how many dives there are, and "0 dives" over a broken read is the plausible lie.
  expect(textIn(t)).not.toContain(NOTHING_LOGGED_MESSAGE);
  expect(counters(t)).toEqual({});
});

// **A screen with no answer must not state one** (§10, M1f). `useDives()` hands back an empty
// list on the renders before its query returns, and every figure here would read `0` or a dash
// for those frames — a whole screen of confident falsehoods about a logbook nothing has looked
// at yet. This is the branch a diver with 128 dives sees for a frame on every launch.
it('states nothing at all until the read has answered', async () => {
  mockUseDives.mockReturnValue(divesState([], { resolved: false }));
  const t = await show();
  expect(counters(t)).toEqual({});
  expect(textIn(t)).not.toContain(NOTHING_LOGGED_MESSAGE);
  expect(textIn(t)).not.toContain(ONLY_PLANNED_MESSAGE);
  expect(textIn(t).join(' ')).not.toContain('Couldn’t open');
});

// --- The empty and near-empty logbook, which is where a stats screen is most easily wrong ---

it('tells a first-run diver what would fill this screen', async () => {
  mockUseDives.mockReturnValue(divesState([]));
  const t = await show();
  expect(textIn(t)).toContain(NOTHING_LOGGED_MESSAGE);
  expect(textIn(t)).not.toContain(ONLY_PLANNED_MESSAGE);
  expect(counters(t)).toEqual({});
});

// **§2.4 made visible, and the near-empty case the rest of this screen is built around.** A
// logbook holding nothing but a plan has been USED — the diver set tomorrow's dive up on the
// boat — so "log a dive" would be telling them to do the thing they just did. What is true is
// that a plan is not a dive yet, which is the same rule that keeps it out of every figure here.
it('tells a diver whose logbook holds only plans that a plan is not a dive yet', async () => {
  mockUseDives.mockReturnValue(
    divesState([dive({ status: 'planned', date: daysAgo(-2), siteName: 'Vis', maxDepthM: 30 })]),
  );
  const t = await show();
  expect(textIn(t)).toContain(ONLY_PLANNED_MESSAGE);
  expect(textIn(t)).not.toContain(NOTHING_LOGGED_MESSAGE);
  expect(counters(t)).toEqual({});
});

/**
 * **The row set does not shrink, and a figure with nothing behind it is an em dash.**
 *
 * One logged dive that recorded nothing but its date is an ordinary logbook — §1 asks a diver
 * for no field but that one — and it is the case a test seeding ten complete dives says nothing
 * about. Every row is still drawn: this screen has one subject and a fixed inventory of figures
 * about it, so a row that vanished would be indistinguishable from the app having dropped it.
 *
 * `Sites` is the deliberate exception and both halves are asserted together, because they look
 * like an inconsistency until the reason is stated: a count of `0` sites is a *fact* about the
 * diver's own data (no dive names a place), while `0` countries would be a *claim about the
 * world* that any diver could disprove — §2.3 gives a country one path onto a dive and sites
 * are new, so what the figure reports is what the app knows.
 */
it('keeps every row and marks the empty figures, for a logbook that recorded almost nothing', async () => {
  mockUseDives.mockReturnValue(divesState([dive({ date: daysAgo(0) })]));
  const t = await show();
  expect(counters(t)).toEqual({
    Dives: '1',
    Underwater: NO_FIGURE,
    Deepest: NO_FIGURE,
    Sites: '0',
    Countries: NO_FIGURE,
    RMV: NO_FIGURE,
    Trend: NO_FIGURE,
    'Last dive': 'Today',
  });
  expect(textIn(t)).toContain(COUNTRIES_UNKNOWN_NOTE);
});

// --- The figures themselves ---

it('renders §3’s three figures, and the Dives header states the same three', async () => {
  const dives = logbook();
  mockUseDives.mockReturnValue(divesState(dives));
  const rows = counters(await show());

  // **Tied to the header line rather than to three literals**, which is the assertion §4.1
  // actually wants: `logbookStats` is one owner with two callers, and what must never happen is
  // the two screens saying different things about one logbook. The header sets its own spaces
  // non-breaking so the line folds on the middots (§0.6, M1m), so they come back out here.
  const header = formatLogbookSummary(logbookStats(dives), 'metric').replace(/ /gu, ' ');
  expect(header).toContain(`${rows.Dives} dives`);
  expect(header).toContain(rows.Underwater);
  expect(header).toContain(`deepest ${rows.Deepest}`);
  // ...and the values are the real ones rather than two identically-broken readings: eight
  // dives, 5 h 17 min of bottom time, deepest 41.2 m.
  expect(rows).toMatchObject({ Dives: '8', Underwater: '5 h 37 min', Deepest: '41.2 m' });
});

// §2.4 on the screen rather than in the domain: a plan carries a site, often a cylinder, and
// nothing stops it carrying a depth — so one that slipped into the population would drag every
// figure here at once. Seeded deeper, longer and somewhere new than anything logged.
it('leaves a planned dive out of every figure on the screen', async () => {
  mockUseDives.mockReturnValue(
    divesState([
      ...logbook(),
      gasDive(20, {
        status: 'planned',
        date: daysAgo(-3),
        siteId: 'site-mt',
        siteName: 'Blue Hole II',
        maxDepthM: 60,
        durationMin: 90,
      }),
    ]),
  );
  mockUseDiveSites.mockReturnValue(catalogueState([site({ id: 'site-mt', country: 'MT' })]));
  // The same eight figures the logged-only logbook produces, written out rather than compared
  // against a second render: every one of them would move if the plan were counted — a ninth
  // dive, ninety more minutes, a deeper deepest, a sixth site, a first country, an RMV out of
  // nowhere, and "Today" instead of two days ago.
  expect(counters(await show())).toEqual({
    Dives: '8',
    Underwater: '5 h 37 min',
    Deepest: '41.2 m',
    Sites: '5',
    Countries: NO_FIGURE,
    RMV: NO_FIGURE,
    Trend: NO_FIGURE,
    'Last dive': '2 days ago',
  });
});

it('converts the depth to the diver’s own system and leaves the hours alone', async () => {
  mockUseDives.mockReturnValue(divesState(logbook()));
  mockUseUnitSystem.mockReturnValue('imperial');
  const rows = counters(await show());
  expect(rows.Deepest).toBe('135 ft');
  // §4.1: `format/units.ts` owns which quantities have a system at all, and time is not one of
  // them — a dive is 47 minutes long wherever it is dived.
  expect(rows.Underwater).toBe('5 h 37 min');
});

// The fold reaches this figure because `sitesVisited` reads `siteIdentityOf` (§2.3): `Kotelna`
// and `kotelna` are one place, `Šárka` and `Sarka` are one place, and the two dives sharing a
// catalogue id are one — five places from eight dives.
it('counts a place once however many dives and spellings are at it', async () => {
  mockUseDives.mockReturnValue(divesState(logbook()));
  expect(counters(await show()).Sites).toBe('5');
});

it('counts countries once the catalogue knows them, and drops the note that explains their absence', async () => {
  mockUseDives.mockReturnValue(divesState(logbook()));
  mockUseDiveSites.mockReturnValue(
    catalogueState([site({ id: 'site-hr', country: 'HR' }), site({ id: 'site-eg', country: 'EG' })]),
  );
  const t = await show();
  expect(counters(t).Countries).toBe('2');
  expect(textIn(t)).not.toContain(COUNTRIES_UNKNOWN_NOTE);
});

// §2.3: the country is derived from the site's own pin and from nothing else, so a site created
// out of signal has `null` by design. A site the diver has dived that knows no country is still
// no country — and the screen says where countries come from rather than printing a nought.
it('learns no country from a site that does not know its own', async () => {
  mockUseDives.mockReturnValue(divesState(logbook()));
  mockUseDiveSites.mockReturnValue(catalogueState([site({ id: 'site-hr', country: null })]));
  const t = await show();
  expect(counters(t).Countries).toBe(NO_FIGURE);
  expect(textIn(t)).toContain(COUNTRIES_UNKNOWN_NOTE);
});

// §3's "RMV trend", as §3's own "counters first": the recent mean, the direction it moved, and
// a caption saying what "recent" covers — because five dives and fifty answer different
// questions and an unstated window makes the figure unreadable.
it('states the RMV, which way it moved, and how many dives that is over', async () => {
  const dives = [20, 20, 20, 20, 20, 10, 10, 10, 10, 10].map((value, index) =>
    gasDive(value, { date: daysAgo(20 - index) }),
  );
  mockUseDives.mockReturnValue(divesState(dives));
  const t = await show();
  expect(counters(t)).toMatchObject({ RMV: '10.0 l/min', Trend: 'down from 20.0 l/min' });
  expect(textIn(t)).toContain('Averaged over the last 5 dives with gas recorded.');
});

// A logbook with no gas recorded is the ordinary one — RMV needs an average depth, a duration
// and a cylinder size together and §2.2 asks for none of them — so both rows dash and the
// caption that would explain a window is not drawn over nothing.
it('draws no window caption when there is no RMV to qualify', async () => {
  mockUseDives.mockReturnValue(divesState(logbook()));
  const t = await show();
  expect(counters(t)).toMatchObject({ RMV: NO_FIGURE, Trend: NO_FIGURE });
  expect(textIn(t).join(' ')).not.toContain('Averaged over the last');
});

/**
 * **And it draws no sparkline either — the case every fixture of complete dives walks straight
 * past** (M3d). This is not an edge: it is every logbook until somebody records a cylinder
 * size, the same eight real dives the tests above use, and the state the owner's own simulator
 * is in. A chart's usual failure here is to draw its furniture anyway — an empty track, a
 * baseline, a row of bars at the floor — and any of those would say "your consumption is flat"
 * beside a row that has just said it does not know it.
 */
it('draws no bars for a logbook where no dive has an RMV at all', async () => {
  mockUseDives.mockReturnValue(divesState(logbook()));
  const t = await show();
  expect(counters(t).RMV).toBe(NO_FIGURE);
  expect(rmvBars(t)).toEqual([]);
});

/**
 * **The bars are the dives the figure is averaged over, and the caption counts the same
 * array.** Three gas dives scattered through eight — the shape of a real logbook, where RMV
 * needs three fields §1 asks for none of — so the five without gas contribute no bar at all:
 * not a zero-height one, which would say the diver used no gas, and not a gap, which at this
 * size is the same mark as a short bar.
 */
it('draws one bar per dive with gas, and none for the dives without it', async () => {
  mockUseDives.mockReturnValue(
    divesState([
      ...logbook(),
      gasDive(12, { date: daysAgo(30) }),
      gasDive(6, { date: daysAgo(29) }),
      gasDive(12, { date: daysAgo(28) }),
    ]),
  );
  const t = await show();
  // The caption states the same count the row draws — one array, so the sentence and the shape
  // cannot disagree about how many dives this is.
  expect(textIn(t)).toContain('Averaged over the last 3 dives with gas recorded.');
  expect(rmvBars(t)).toHaveLength(3);
  // Eleven dives in the logbook and three bars: the eight without gas are not in the series.
  expect(counters(t).Dives).toBe('11');
});

/**
 * **Only the window the figure covers**, oldest at the leading edge. Seven dives with gas, and
 * the two earliest are the two heaviest — so a row that drew the whole logbook would draw seven
 * bars, and one that drew the right five against the wrong maximum would draw them all shorter.
 * The expectation is written as proportions of the tallest bar in the window (`RMV_SPARK_STEPS`
 * cells), which is what a bar measured from zero means.
 */
it('draws the window the figure is averaged over, and not the whole logbook', async () => {
  const trip = [20, 20, 12, 6, 2, 12, 6].map((value, index) =>
    gasDive(value, { date: daysAgo(20 - index) }),
  );
  mockUseDives.mockReturnValue(divesState(trip));
  const t = await show();
  expect(rmvBars(t)).toEqual([
    RMV_SPARK_STEPS,
    RMV_SPARK_STEPS / 2,
    RMV_SPARK_STEPS / 6,
    RMV_SPARK_STEPS,
    RMV_SPARK_STEPS / 2,
  ]);
  // Drawn, and still nothing the sheet did not hand out: a bar whose height was composed inline
  // at render is the "dropped-in chart" `unexpectedGraphics` exists to report, and the sweep two
  // tests below runs on a logbook with no gas in it, where there is nothing drawn to sweep.
  expect(unexpectedGraphics(t, 'light')).toEqual([]);
});

// --- Currency, and the difference between a dive and a booking ---

it('counts the days since the last dive that actually happened', async () => {
  mockUseDives.mockReturnValue(
    divesState([
      dive({ date: daysAgo(12) }),
      // A plan for next week must not answer "when did you last dive" — §2.4, and the
      // difference between "you dived yesterday" and "you have a dive booked".
      dive({ status: 'planned', date: daysAgo(-7) }),
    ]),
  );
  expect(counters(await show())['Last dive']).toBe('12 days ago');
});

it.each([
  [179, false],
  [200, true],
])('nudges a refresher at %i days: %s', async (days, nudged) => {
  mockUseDives.mockReturnValue(divesState([dive({ date: daysAgo(days) })]));
  const t = await show();
  expect(counters(t)['Last dive']).toBe(`${days} days ago`);
  expect(textIn(t).includes(REFRESHER_MESSAGE)).toBe(nudged);
});

// --- §0.1's sweep, on a screen whose figures include a real depth ---

/**
 * **The deepest dive is a depth and still takes no band colour.** §10 has ruled it twice now —
 * M1l's summary line and M2n's map pins — for the same reason both times: every figure here is
 * an aggregate over a set of dives, and no single band is true of a set. This is the third
 * screen where the temptation arrives, and the first where the figure sits in a column of
 * totals that would make hue mean "this one happens to be a depth".
 */
it('paints nothing from the depth scale, though one of its figures is a depth', async () => {
  mockUseDives.mockReturnValue(divesState(logbook()));
  const t = await show();
  // `useColorScheme()` reports light under Jest, so the sweep runs against the sheet that
  // actually rendered; both palettes are checked because a dark band colour on a light render
  // would be just as wrong and would slip past a one-palette check.
  for (const colour of [...depthScale.light, ...depthScale.dark]) {
    expect(inkColours(t)).not.toContain(colour);
  }
  expect(unexpectedGraphics(t, 'light')).toEqual([]);
});

// §0.6 gives the capsule to screens with something to do to their data — search it, add to it,
// switch its layer. This one is a read of a logbook written elsewhere, so it floats none, and
// its title takes the full content column with no trailing cap reserved for glass that is not
// there.
it('floats no action capsule, so its title needs no cap', async () => {
  mockUseDives.mockReturnValue(divesState(logbook()));
  const t = await show();
  const styles = makeStyles('light');
  expect(allNodes(t).some((n) => [n.props?.style].flat(5).includes(styles.capsuleFloat))).toBe(false);
  expect(allNodes(t).some((n) => [n.props?.style].flat(5).includes(styles.statsHeading))).toBe(true);
});

// The last row's clearance is the device's, not a constant (`screenBottomInset`,
// theme/styles.ts): this ScrollView is its root's only child, so it runs to the bottom of the
// display and what the inset reports on a screen inside `(tabs)` already contains the Liquid
// Glass bar. Without it the last counter scrolls under the glass — the defect that owner was
// written for, arriving on a third screen.
it('keeps its last counter clear of the tab bar', async () => {
  mockUseDives.mockReturnValue(divesState(logbook()));
  const t = await show();
  const styles = makeStyles('light');
  const content = allNodes(t)
    .flatMap((n) => [n.props?.contentContainerStyle].flat(5))
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null);
  expect(content).toContainEqual(styles.statsContent);
  // The mock safe-area provider reports 0 at the bottom, so what is asserted is that the OWNER
  // was asked rather than a number typed — `screenBottomInset` floors it at the app's own
  // minimum, which is what makes this comparison worth anything.
  expect(content).toContainEqual({ paddingBottom: screenBottomInset(0) });
});
