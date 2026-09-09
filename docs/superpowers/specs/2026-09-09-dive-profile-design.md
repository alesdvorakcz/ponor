# Dive profile rendering — design

> **Spec B of two.** Spec A (`2026-09-08-dive-import-design.md`) got dives *in* and put real
> sample series in the database. This one draws them: §0.4's depth profile on the dive detail,
> its consumption companion, and the row sparkline.
>
> It was deliberately written second. §0.4 forbids drawing a curve from anything but real
> samples, so the chart could not be honestly designed — or its maths verified — until Spec A
> had landed 222 real points from a real dive. Every number in this document was measured
> against that dive, not estimated.
>
> Status: approved in outline (owner, 2026-09-09), pending review of this document.

---

## 1. What §0.4 already decided

This spec inherits four rulings rather than re-opening them:

- **The chart's home.** "The chart occupies the space between the detail hero and the first
  cluster, which is empty today, and nothing above it moves." Checked in a design pass after M1b.
- **Its colour is data.** "The curve is stroked through the depth gradient — a profile is depth
  against time and colour already encodes depth, so the chart's colour is data under the same
  rule as everything else."
- **The row sparkline is monochrome.** "The number already carries the colour there, and at
  46 px a gradient reads as a smudge, so the sparkline contributes shape and the number
  magnitude."
- **Nothing is drawn without samples.** "A row without samples shows no sparkline and no
  placeholder, exactly as a dive without a depth shows no number."

The owner supplied a design mock during this session which settles the rest of the card's
furniture: a `DEPTH PROFILE` cluster label with the sample count and interval trailing, a left
depth axis with gridlines, a bottom time axis, the deepest sample marked, and an `Imported from`
row beneath.

## 2. The drawing primitive — an amendment to §10

**§10 records `react-native-svg` as deliberately absent, and this spec reopens it with new
information.**

The rule was argued in §3, about the RMV sparkline: *"this app has no drawing primitive,
`react-native-svg` is deliberately absent, and a bar row is what the first-run legend and the
rating dots are already made of."* Every drawing in the app until now has been a rectangle — six
legend bars, five rating dots, a row of RMV bars.

A depth profile is a different object, and the difference is measurable:

| | rotated `View`s | `react-native-svg` |
|---|---|---|
| detail chart | ~420 native views (222 depth + ~200 gas) | ~10–30 `Path`s, one per colour run |
| row sparkline | ~40 views **per row** | 1 `Path` per row |
| joins | faceted at sharp angles | `stroke-linejoin: round` |

The rotated-`View` technique was built and looked at during design: a line is drawn as one
absolutely-positioned `View` per segment, `width` = the distance between points, rotated by
`atan2(dy, dx)`, with each segment extended by its own stroke thickness so the joints overlap.
It works, and at a glance it reads as a line. It still facets where the curve turns sharply,
which the owner saw and named.

**The row sparkline is the stronger half of the argument.** Forty views per row, on the Dives
list — the screen a diver scrolls most — is roughly 600 additional native views for fifteen
visible rows, to draw fifteen small monochrome curves.

**`RmvSparkline` is not converted.** It genuinely is a bar row, so §10's original reasoning
still holds for it exactly as written. Converting it would be change for symmetry's sake.

**Cost, stated:** a native dependency, installed with `npx expo install react-native-svg` so the
version matches the SDK, and one more dev-client rebuild.

## 3. The depth curve

- **One `Path` per colour run.** Consecutive samples in the same depth band share a path; the
  path breaks where the band changes. That is what makes the colour *data* rather than a
  gradient — each stroke is the colour of the depth it represents, from `depthColor()`
  (theme/depth.ts), which already owns that mapping.
- **Vertical scale** runs 0 to `ceil(maxDepthM / 10) * 10`, with a gridline and label every 10 m.
  Taken from `Header.Depth.Max`'s stored `maxDepthM`, not from the samples — Spec A §4.2 records
  why the header value is the true maximum and the series can be shallower.
- **The deepest sample is marked** with a dot in its own band's colour.
- **Time axis:** start, midpoint and end, in minutes.
- **Cluster metadata:** `<n> samples · <interval> s`, where the interval is the **median** delta
  between samples. Stating the median rather than the file's declared `SampleInterval` is
  deliberate: the reference dive declares 10 s and its real deltas run 9.74–10.10.

## 4. The consumption curve

### 4.1 What it is

Instantaneous **RMV** — surface-equivalent litres per minute — over a moving window:

```
litres  = Δbar × cylinder sizeL
ata     = mean depth over the window / 10 + 1
rmv     = litres / minutes / ata
```

**This must share `domain/derived.ts`'s core, not restate it.** That module already owns RMV for
the whole-dive figure the Stats screen shows. Extract the arithmetic so the single figure and the
windowed series call one function. Otherwise the chart and the Stats sparkline are free to drift,
which is §4.1's defining defect — and the fact that they currently agree (14.8 windowed against
14.7 whole-dive on the reference dive) would be luck rather than structure.

### 4.2 The window is 60 seconds, and the evidence is measured

The owner supplied the same dive as rendered by the Suunto app, and asked why our curve was
shaped differently. **The entire difference was the window length.** Minute-by-minute RMV on the
reference dive, against the Suunto rendering:

| | first minute | 12–22 min | ~29 min | final minute |
|---|---|---|---|---|
| computed | 35 → 32 | ~13 | 9.2 | **19.4** |
| Suunto | ~32 | ~13–14 | ~9 | **~20** |

A 180-second window flattened exactly the peaks Suunto shows. Comparing windows on the same dive:

| window | mean l/min | negatives | last point |
|---|---|---|---|
| **60 s** | **14.8** | **0** | 36:21 → 19.6 |
| 90 s | 14.5 | 0 | 36:06 → 19.7 |
| 120 s | 14.3 | 0 | 33:11 → 8.6 |
| 180 s | 14.0 | 0 | 33:31 → 6.6 |

60 s wins on every axis that matters: it reproduces the shape, it has no negative values, and its
mean sits closest to the whole-dive figure of 14.7 that `derived.ts` computes independently.

**`PROFILE_RMV_WINDOW_S = 60` is a named constant**, because the owner asked to be able to tweak
it and because this table is the argument for the number rather than a proof of it.

### 4.3 Three rules, each of which was wrong once

**A point is drawn only where a complete window exists.** The first implementation widened its
window until it ran out of samples, so the last points silently fell back to noisy 10-second
readings — producing a phantom spike to 36 l/min at the dive's end, the tallest and least
meaningful point on the chart. The rule costs about half a window at each end and removes the
artefact by construction.

**No point above 1.5 m.** As depth approaches the surface `ata` approaches 1, so any pressure
change inflates; and a diver at the surface is often off the regulator. The trace therefore
starts on descent and stops on ascent, and the gap is visible rather than filled.

**A gap in the data stays a gap.** Where consecutive points are more than two windows apart —
the diver was above 1.5 m in between — the trace breaks rather than bridging the interval with a
straight line it did not measure.

**Worth recording, because it nearly cost a wrong decision:** 180 s was first chosen because raw
10-second readings are 10% non-positive — the transmitter reports pressure *rising* — and a
negative RMV claims the diver produced gas. That reasoning was sound and the conclusion was
wrong: the negatives are the surface artefact, which the 1.5 m floor already removes. Two rules
adopted for separate reasons turned out to overlap, and only measuring both windows against the
floor showed it.

### 4.4 What is not explained

Suunto's trace and ours still differ in detail through the ascent. Every measure of gas use in
the reference dive **declines** monotonically — bar/min 4.18 → 1.01, ambient 50.2 → 12.1 l/min,
RMV 15.9 → 9.4 — so no normalisation of the recorded data produces a curve that rises there. The
difference is therefore in Suunto's smoothing or anchoring, which cannot be determined from a
screenshot. Recorded so the next reader knows it was examined rather than missed.

### 4.5 Presentation

- **Monochrome, muted ink.** §0.1 spends colour on depth and has none to give a second series;
  muted also reads as secondary, which it is.
- **Right axis in l/min**, 0 to `ceil(max / 10) * 10`, matching the depth axis's own rounding
  rule so the two sides of the plot are scaled by one convention rather than two.
- **Absent entirely when the dive has no per-sample pressure** — a dive logged without a tank
  transmitter (Spec A §4.2). No trace, no right axis, no legend entry.

## 5. The interaction

**A fixed readout above the chart, not a floating tooltip.** A tooltip under the finger is
covered by the finger and clips at both plot edges. The card carries a header row showing depth
and gas for the scrubbed position, plus a vertical hairline at the touch point.

- **Before any touch the readout shows the deepest sample** — the point already marked with a
  dot. Never empty, never shifts the layout, always real data, and it explains what the dot is.
- **Horizontal activation only.** The dive detail is a `ScrollView`, so the pan gesture sets
  `activeOffsetX`: a vertical drag still scrolls the page, a horizontal one scrubs. Without it
  the chart traps the scroll, which reads as a broken page.
  `react-native-gesture-handler` is already a dependency.
- **An em dash where there is no gas value** — inside the surface break, or on a dive with no
  transmitter. The readout follows the same rule as the trace.

## 6. The row sparkline

Monochrome, per §0.4. One `Path`, downsampled to roughly 40 points — the row is 46 px tall and
more points buy nothing there. No axes, no marker, no interaction. Absent, with no placeholder,
for a dive with no samples.

**Downsampling keeps the extremes, and that is not a detail.** Taking every *n*th sample would
routinely drop the deepest point — the reference dive's maximum lands on a single sample — so a
sparkline drawn that way would show a shallower dive than the number beside it. The series is
bucketed instead, and each bucket contributes its deepest sample, so the silhouette's lowest
point is always the dive's real maximum and the row's shape agrees with the row's figure.

## 7. The `Imported from` row

Two deliberate departures from the owner's mock, both from rules already in the plan:

- **No chevron.** §0.6: the chevron marks in-place disclosure and *"is never spent on
  navigation"* — and there is nowhere to navigate to. It is a plain value row.
- **It names the device where the dive carries one** (owner's call, 2026-09-09). Spec A stored
  `import_source` but not the device model, so this spec adds a sibling column, `import_device`,
  populated by the importer from the export's own `DeviceLog.Device.Name` — `Suunto D5`.

  **It falls back to the importer's label when that column is null**, so the row reads
  `Imported from · Suunto` rather than going blank. The fallback is not defensive tidiness; it is
  the state every dive imported before this change is permanently in — see below.

**The two dives already imported cannot be backfilled, and that is a consequence of a rule we
chose deliberately.** Dedupe skips a dive it already has, so re-running the same files writes
nothing; and a dive the diver deletes *stays* deleted on re-import (Spec A §6), so deleting them
first does not help either — the tombstoned rows still match. Short of *Start over*, those dives
keep `import_device = null` for ever and display the fallback. That is the correct outcome for a
rule that exists to protect a diver's edits from a re-import, and it is named here so nobody
reads the fallback as dead code.

**What the column costs.** `push_changes` enumerates the `dives` columns explicitly in three
places — the insert list, the values list, and the `on conflict do update set` — so the column
lands in `src/db/schema.ts`, a client migration, `supabase/migrations/`'s table, and those three
RPC sites. `schemaParity` and `syncRpcParity` fail loudly if any is missed, which is what makes
the change mechanical rather than risky.

## 8. Modules

```
src/domain/profile.ts        pure geometry: samples → scaled points, colour runs, axis ticks,
                             downsampling. No rendering, no React.
src/domain/consumption.ts    windowed RMV, sharing derived.ts's extracted core
src/components/DepthProfile.tsx     the detail card, its axes, scrub gesture and readout
src/components/ProfileSparkline.tsx the row sparkline
src/db/useDiveSamples.ts     the read
```

Plus, for §7's column: `src/db/schema.ts`, a client migration, `supabase/migrations/`'s `dives`
table and the three `push_changes` sites, and `src/domain/import/suunto.ts` to populate it.

Touched: `DiveDetailScreen` (insert the card; its docblock currently asserts *"No profile chart,
sparkline, or other graphic is drawn"*, which becomes false), `DiveRow` (sparkline slot),
`domain/derived.ts` (extract the RMV core), `i18n` both languages, `package.json`, `DESIGN.md`.

## 9. Testing

The pure modules carry the weight, because every judgement in §3 and §4 is falsifiable against
the committed fixture from Spec A:

- colour runs split exactly where the band changes, and each run's colour comes from its own depth
- the vertical scale rounds up to the next 10 m, and uses `maxDepthM` rather than the deepest sample
- the stated interval is the median delta, not the file's declared `SampleInterval`
- a 60 s window over the fixture reproduces a mean within 1 l/min of `derived.ts`'s whole-dive figure
- no point is emitted from an incomplete window — the specific regression that produced the 36 l/min spike
- no point is emitted above 1.5 m, and a gap wider than two windows is not bridged
- a dive with samples but no pressure yields a depth curve and no consumption series at all
- the `Imported from` row names the device when `import_device` is set, and falls back to the
  importer's label when it is null — the state every previously-imported dive is in
- scrubbing to a position inside a gap yields no gas value

Rendering tests assert what is drawn rather than how it looks: a samples-free dive renders no
card, a pressure-free dive renders no right axis, and the readout defaults to the deepest sample.

## 10. DESIGN.md changes this spec requires

- **§10** — amend the `react-native-svg` decision: the rule was argued for a bar row, a dense
  curve is a different object, the view counts are the new information, and `RmvSparkline` is
  unchanged because its original reasoning still holds.
- **§0.4** — its promise is now built; record the 60 s window, the complete-window and 1.5 m
  rules, and that the consumption companion joined the depth curve at the owner's request.
- **§3** — the dive detail gains the profile card; Settings is untouched.
- **§9** — move the profile out of the post-release shelf, as the owner's call, dated.

## 11. Out of scope

- Temperature, ceiling, no-deco time and time-to-surface, all of which the stored series or the
  Suunto file carry. Depth and gas are what was asked for; a third trace needs its own argument.
- Any chart on the Stats screen. `RmvSparkline` stays as it is.
- Zoom, pinch, or a selectable time range.
- Exporting the chart as an image.
- Profiles for dives without samples. §0.4 forbids it and nothing here changes that.
