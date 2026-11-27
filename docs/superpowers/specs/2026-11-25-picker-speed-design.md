# Site and centre picker: keep it fast as the catalogue grows — design

Issue #36. A short design: the owner picked the approach on 2026-11-25.

## Why

The site and centre picker (#19) redoes work that grows with **catalogue rows × logged dives** on
every keystroke. Today's catalogue is nearly empty, so nobody sees it. The catalogue grows with
every search and Near me answer pulled from the server, and faster once guests can read it (#28).
A long logbook multiplies it.

Measured before any change, under Jest on a Mac (V8; Hermes on a phone is several times slower).
The data was invented: random names, dives spread over 120 of the sites.

| catalogue × logbook | nothing typed | one letter | "kote" |
|---|---|---|---|
| 300 × 200, every dive paired by id | 5.6 ms | 3.2 ms | 0.2 ms |
| 5,000 × 1,000, every dive paired by id | 96 ms | 59 ms | 4.4 ms |
| 5,000 × 1,000, 30 % paired by name only | 813 ms | 448 ms | 19 ms |
| 20,000 × 2,000, 30 % paired by name only | 5.6 s | over a minute | 128 ms |

**The cause.** For each catalogue row, `pickerGroups` filters every logged dive through
`diveBelongsToCatalogueRow`. A dive paired by name re-folds both names on every comparison.
`browseCatalogue`'s sort also folds both names on every comparison.

## Goals

- Typing in the picker shows no lag on a simulator seeded with 5,000 sites and 1,000 dives,
  30 % of them paired by name only. Measured before and after, and the numbers go in the PR.
- The groups are unchanged, row for row and in the same order: `src/domain/placePicker.test.ts`
  still passes as it is.
- Each screen reads only the rows it draws from (the issue's costs 2 and 3).

## Non-goals and anti-goals

- **No change to stored data or sync.** Approach 3, matching in SQL, is not taken.
- **No change to what the picker shows.** That includes groups, order, the *Selected* line,
  provenance and *also called*.
- **No debounce.** A result that arrives late is a different kind of lag.
- The Map, the site and centre lists, and the site and centre pages keep their whole-table reads.
  The Map draws every row. The two pages are not in the issue.
- **A failure, even if it gets faster:** a dive missing from *Dived here* that today's rule puts
  there, or the reverse.

## Approaches

1. **Grouping only.** Build a lookup of the dives once per logbook change, and fold each name once
   per pass. This fixes the dominant cost, but each screen still reads whole tables.
2. **Grouping, plus narrow reads.** Picked by the owner. Option 1, and also: the picker reads only
   its own table, plus the one paired site for *Near [site]*. The form's Site and Centre rows read
   their one row by id. This covers all three costs the issue names, and the by-id site read already
   exists (`useDiveSite`).
3. **Matching in SQL**, with a stored folded-name column and a limit. This changes the stored shape
   and the sync. It is held back unless approach 2 still lags at 20,000 rows on a device.

## The design

**One pairing lookup per logbook** (`domain/catalogueDives.ts`).
- It sorts the logged dives into two maps:
  - by paired id;
  - by folded snapshot name, for the dives with no id.
- A row's dives are its id's entry plus its folded name's entry. They are handed back in the order
  the dives were given, which is exactly what filtering with `diveBelongsToCatalogueRow` returns.
  The lookup is a second reading of that one rule, so a test checks the two against each other on
  varied data:
  - dives with an id and without one;
  - accents, case and spaces in names;
  - nameless rows;
  - plans;
  - malformed rows.
- Sites and centres each supply their pairing (`siteId`/`siteName`, `centerId`/`centerName`), as
  `isDiveAtSite` and `isDiveWithCenter` do today.

**`pickerGroups` uses the lookup without changing its input.** It keeps a cache keyed by the
dives array it was handed, one entry per kind. The screen already keeps that array the same between
keystrokes (`history`, memoised on `dives`), so typing reuses the lookup and a logbook change
rebuilds it. The tests' calls stay exactly as they are.

**`browseCatalogue` folds each name once per call.** It decorates, sorts and undecorates, so a sort
no longer folds on every comparison. Other callers get the same answer.

**The picker's reads.** `PlacePickerScreen` gets one small wrapper per kind, as the form already
has with `SitePlaceField` and `CentrePlaceField`.
- The site picker reads the sites table and dives.
- The centre picker reads the centres table, dives, and the dive's paired site by id
  (`useDiveSite`).
- The page body takes the places, their read state and the paired site as props.

**The form's rows read one row.**
- `SitePlaceField` uses `useDiveSite(id)`.
- `CentrePlaceField` uses a new `useDiveCenter(id)` over a new `diveCenterRowQuery`. `getDiveCenter`
  moves onto it, so the one-off fetch and the live read cannot read a row two ways, as on the site
  side.
- `PlaceField` takes the one row, or null, instead of a list.

**Measuring.**
- A seed script, kept outside the repo, writes invented rows into a simulator's database: 5,000
  sites, 1,000 dives, 30 % of them paired by name only, and no real places.
- A temporary timing log around the grouping, never committed, measures a keystroke before and
  after.
- CI gets no timing assertions, since a timing test is flaky. The equivalence test and the
  unchanged `placePicker.test.ts` are the guard.

**Records.** DESIGN.md §10 gets an entry saying the picker pairs through a lookup built once per
logbook, which `diveBelongsToCatalogueRow` still defines. §9 marks #36 done.

## Left to the builder

- The lookup's exact type and name, and where the per-kind accessor lives.
- Whether the cache is a `WeakMap` or a one-entry memo.
- Whether anything else in `pickerGroups` is worth caching. Only if the simulator still shows lag
  after the above, and say so in the PR.
