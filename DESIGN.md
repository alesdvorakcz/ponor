# Ponor — Design Plan

> **v1 scope · rev 5 · 2026-08-28**
> Core decisions: **Supabase** backend · **offline-first** · **optional sign-in** · photos in **v1.1**
> Name and visual identity locked in §0; both themes ship from M0.
> Styled copies of this document and of the visual identity live as Claude artifacts; their links are kept out of this public repo.

A free, offline-first dive log for iPhone, Android, and tablets — web to follow — that *fills itself in*: after the first dive of a trip, you only touch what changed.

---

## 0. Name & visual identity

**The app is called Ponor.** In Czech, *ponor* is the submersion itself — the draft of a vessel, how deep a thing sits; the root of *ponořit se*, to submerge. In English it is a karst term: the opening where a surface stream leaves the daylight and becomes a subterranean river. The same meaning in both languages, the same pronunciation (PO-nor), it declines cleanly in Czech, and it spells itself when heard. **`ponor.app` is registered.**

Checked and rejected on availability: *Slate*, *Bezel*, *Sextant* (crowded on the App Store), *Halocline* (Halocline GmbH holds software-class trademarks), *Atoll* (Forsk's registered software mark), *Manta* (an existing paper dive logbook), *Deco* (TP-Link, plus an existing dive-planning app). Note that every competitor is a dive+log mashup — Dive Log, Diving Log, Divog, Diviac, DiveMate, Diveboard, Depth, Subsurface — so a name in a diver's own vocabulary stands apart by default. Still outstanding: a direct App Store and Play Store search, and a trademark register check.

### 0.1 Colour is depth, and colour is nothing else

Water strips colour out in a fixed order — red is gone by about 5 m, then orange, then yellow, then green; blue is what is left. The depth scale **is** that sequence, so a depth always carries a colour and the colour is physically true.

| Band | Dark | Light |
|---|---|---|
| 0–6 m | `#FF6B4A` | `#E04A28` |
| 6–12 m | `#FF9F43` | `#C2600A` |
| 12–20 m | `#F5CE3E` | `#8F7000` |
| 20–30 m | `#3FCB94` | `#0E9F6E` |
| 30–40 m | `#2E9BE0` | `#0B76B8` |
| 40 m + | `#6673E4` | `#3A49C0` |

Because colour is spoken for, **every control is monochrome** — the primary button is simply inverted ink. Depth is always redundantly encoded by the number itself, so the scale never carries meaning on its own: colour-blind safe, and legible in glare.

### 0.2 Theme tokens

Both themes ship from M0. The app follows the OS and the choice is overridable in settings; components read whichever token set `resolveScheme` returns, so the same component serves both.

| Token | Role | Dark | Light |
|---|---|---|---|
| `bg` | App ground | `#080B0F` | `#EDEEEA` |
| `surface` | Cards, fields, charts | `#111820` | `#FFFFFF` |
| `border` | Hairlines, dividers | `#212D38` | `#CDD3CC` |
| `fg` | Text and values | `#F0F5F8` | `#0D1216` |
| `fg-muted` | Labels, units, metadata | `#7C8D9A` | `#5A6670` |
| `action` / `action-fg` | Primary button — inverted ink | `#F0F5F8` / `#080B0F` | `#0D1216` / `#EDEEEA` |
| `depth-1…6` | Depth scale — **data only, never chrome** | see §0.1 | see §0.1 |

**Type:** *Archivo* for UI and display, *IBM Plex Mono* for all data — depths, pressures, durations, timestamps — with tabular figures wherever digits align in a column. Both carry Latin Extended, which Czech needs (ě š č ř ž ů). The wordmark is Archivo, uppercase, tracked +0.2 em, following the vernacular of dive-instrument brands.

### 0.3 The mark

A dive profile under a wavy surface: a steep descent, bottom time, then a staged ascent that ends in open water rather than climbing back to the waterline. Both of those are load-bearing, and it took four rounds of rendering to find out why. A profile that closes at the top against a straight surface line reads unmistakably as a **bucket** — two matching diagonal walls over a flat base. Ending the ascent in open space removes the second wall; making the surface a wave says "water" instantly. Stroked in the depth gradient, flat single-colour below ~32 px, and the same shape the app will draw for an imported dive — so the icon is a sample of the product rather than a badge stuck on it.

The gradient stops are read from `depthScale.dark` at build time, so the mark cannot drift from the palette. The wave itself is stroked `#5A6C78` — deliberately **not** a theme token. It is a brand-asset colour belonging to the mark alone, chosen to sit quietly behind the profile on the icon's dark ground; it is never used in the interface, where `fg-muted` serves that role.

### 0.4 Profiles are drawn only from real data

A dive row shows the **coloured depth number and no graphic**. When a dive has a real sample series — post-v1, from a UDDF / Subsurface / FIT import — that same row grows a profile sparkline and the dive detail gains a profile chart, automatically and without a redesign. The app never draws a schematic curve interpolated from max depth, average depth and duration: an invented shape on a dive log reads as recorded data, and it isn't.

That claim was checked rather than assumed (design pass after M1b): the chart occupies the space between the detail hero and the first cluster, which is empty today, and nothing above it moves. **The curve is stroked through the depth gradient** — a profile is depth against time and colour already encodes depth, so the chart's colour is data under the same rule as everything else, and the chart becomes the same object as the mark in §0.3. In a row the sparkline stays **monochrome**: the number already carries the colour there, and at 46 px a gradient reads as a smudge, so the sparkline contributes shape and the number magnitude. A row without samples shows no sparkline and no placeholder, exactly as a dive without a depth shows no number.

### 0.5 Constraints the design must answer

- **Sunlight.** Dives are logged on an open deck at noon. The light theme exists for this; contrast is a functional requirement, not a taste question.
- **Wet hands, one thumb.** Tap targets never below 48 dp, and the primary action sits in the bottom third of the screen.
- **Czech runs 20–30 % longer** than English. Labels wrap to two lines rather than truncate.

### 0.6 Screen composition

Designed after M1b, once the built screens showed the tokens being *obeyed* without being *used* — every element the same size, and the depth colour reduced to a small number at the end of a row. The rule below is what makes the palette legible.

**Search is a floating capsule at the bottom, beside the `+`.** Measured off iOS 26 Messages rather than recalled: no bar, no border, no top rule — a fully rounded capsule resting *on* the content with about 24 dp clear either side, separated by a soft shadow, an SF Symbol magnifier at its leading edge (`expo-symbols`), and the app's Liquid Glass material where the device has it (`expo-glass-effect`, guarded by `isLiquidGlassAvailable()`; a plain `surface` capsule everywhere else, which is the common case and must look deliberate rather than degraded). The list runs full width underneath it.

It sits at the bottom for two reasons. §0.5 already says the primary action belongs in the bottom third — the `+` obeyed that and search never did — and at the top the field was the brightest object in the app, competing with the dives it sits above. **One deliberate divergence from iOS: the `+` stays at the bottom too**, as its own floating button beside the capsule, where Apple would put compose in the nav bar. Wet hands and one thumb outrank the convention.

Both recede as the list scrolls down and return on the way up. A logbook is scanned far more often than searched, so neither earns its space until reached for.

**Depth is the anchor of a dive row.** It is the value that actually differs dive to dive — a trip is four rows all saying "Blue Hole" — and it is the one the palette exists to encode. It is set in IBM Plex Mono Medium at 20 px (34 px on dive detail), in its band colour, right-aligned with tabular figures so a column of dives has a column of aligned decimals. Nothing else in a row gains colour.

| Element | Face | Size | Treatment |
|---|---|---|---|
| Depth value | Plex Mono Medium | 20 / 34 | Band colour, tabular, right-aligned |
| Site name | Archivo Medium | 16 | Wraps to two lines, never truncates |
| Trip header | Archivo SemiBold | 11.5 | Uppercase, +0.13 em, muted; date range in mono, trailing |
| Dive number | Plex Mono | 11 | Muted, above the site name — a label, not a headline |
| Row metadata | Plex Mono | 11.5 | Time · duration · rating, middot-separated |
| Cluster label | Plex Mono | 10.5 | Uppercase, +0.14 em, muted |
| Computed value | Plex Mono | 13.5 | Muted ink, `=` prefix in a fixed-width slot before the value |

**Computed values are marked as computed.** Every value the app derives rather than the diver enters — time out, surface interval, used pressure, gas used, RMV and MOD — is prefixed with a muted `=` and sits in muted ink. The mark is an equals sign because that is literally what the value is: the result of a calculation, not something anyone typed. An earlier version used a small outlined square, which read as a rendering artefact rather than a deliberate mark — a symbol that needs a legend has already failed. A diver should never have to wonder which numbers came off their computer and which the app worked out. The rule is *derived or entered*, with no exception for arithmetic simple enough to do in your head: used pressure is start minus end, and it is marked for the same reason RMV is. Anything in `src/domain/derived.ts` is marked.

**Carry-over marks what it inherited.** A prefilled field shows a `carried ×` chip. Accepting costs nothing — no confirmation, no tap; overwriting is just typing, and drops the chip; the `×` clears the field to a real blank, never a zero (§10). The form header's "from #6" is tappable and starts the dive blank, for the dive that has nothing in common with the last.

**Chrome the type scale does not cover.** Hairline separators on `border` divide dive rows, **set on each row's top edge, not its bottom**. That is not interchangeable: a top edge puts a line under the trip header, where the design wants one, while a bottom edge puts every line one position later and leaves the header touching its first row. The last row of a group therefore carries no line beneath it — groups are separated by the next header's own top padding, not by a rule. Without any of this the list is one undifferentiated column. The day strip's action is a bordered pill in tracked uppercase, not plain text, so it reads as a control rather than a label. The dive-detail back control is mono, muted and small — it is a way out, not a heading. Rating marks are **drawn**, not typed: `●` and `○` are different sizes in almost every typeface, so a rating rendered from glyphs looks broken; draw both as circles of one diameter, filled or outlined. **Leaving a screen has one treatment everywhere** — the dive-detail back control's mono/muted/small form is also the form's way out (`‹ Cancel`), so "this takes you back" reads the same wherever it appears and never competes with the primary action beneath it. A form with no visible way out was shipped once and only found by using the app: swipe-back worked, so every test passed and nothing on screen said you could leave. **"Up next" is a section header but not a trip,** so it takes full `fg` where a trip's title is muted, and puts its dive count in the same trailing slot, same mono face, that a trip fills with its date range — an empty slot there read as a date range that had failed to load. Ink versus muted ink is the only lever: §0.1 rules out a hue, and a new shape would be new vocabulary for one header. **The dive-detail back control aligns to the hero's own 16,** and the hero's top padding drops to 4: the control keeps its 48 dp tap-target floor (§0.5), and without that trim the floor's leftover slack and the hero's padding stack into a visible gap between the way out and the title.

**Hand-ordering lives on a day strip, not a row.** A trip spans several days but only one may be reorderable, so a control on the trip header would be ambiguous. Days that qualify get a strip — `18 Aug · 2 dives, no times` — which also states *why* they qualify; without it a diver who adds a time watches the control vanish for no visible reason. Entering the mode dims the rest and puts the arrows in the slot the depth value occupies, so row heights do not change.

**The form is the dive detail you can type into** (designed after M1d, for the same reason the rest of §0.6 was designed after M1b: the screen was built to §2.2's structure and then styled by default, and it ended up speaking a different visual language from the rest of the app for identical content — a depth typed in Archivo and read back in Plex Mono). The form borrows the detail screen's grammar rather than inventing one:

- **A field is a row, not a box.** Label at the leading edge in Archivo 15 muted — the detail screen's own row label — and the value trailing. Separated by a hairline on each row's **top** edge, the same rule dive rows follow. Five bordered boxes down the core strip was the heaviest chrome in the app, drawn in advance for every field whether or not it was being used.
- **Figures in mono, names in sans.** A depth, duration, pressure or temperature is a data figure and takes Plex Mono 15 with tabular figures (§0.2); a site, centre or buddy is a name and stays Archivo. The unit follows the figure as a muted suffix, exactly as `12.2 m` reads on the detail, and an empty numeric field shows that unit as its placeholder so the row still says what belongs in it.
- **Focus is what draws the affordance.** The focused row fills with `surface`; nothing else does. The box appears where it is wanted instead of five times over.
- **A group header is a cluster label** — Plex Mono 10.5, uppercase, +0.14 em, muted. *Conditions* and *Gas & cylinders* name the same groups on both screens and used to carry two different treatments.
- **A field error is text, not a field.** Muted, trailing, under the row it belongs to. Shipped once as a white rounded box the same height as an input, which read as a second empty field rather than a message.
- **Autocomplete's position is fixed here; its styling is not.** The list belongs directly under the focused row. How it looks waits for M2, which reworks site search around the shared site database and adding new sites — designing it now means designing it twice.

**Option chips and the group header** (owner's calls, after seeing the form built):

- **A chip is filled.** `surface` behind an unselected chip, `action` ink behind the selected one — the same invert the save control uses, so "the chosen thing is the inverted thing" is one rule across the app. This does put a `surface` fill on two different things (a chip, and the focused row); they are told apart by shape and scale rather than by colour, a small pill inside a row against a full-bleed fill. Recorded as a known trade-off, not an oversight.
- **An icon appears only where the value has one.** *Shore* and *boat* do. *Salt*, *fresh* and *brackish* do not, and neither do *wet*, *semidry* and *dry* or *steel* and *alu* — drawn as icons those collapse into near-identical droplets and suits separated by tally marks, which is a legend. §10's computed-value square is the precedent: a symbol that needs a legend has already failed. So the icon is information, not decoration, and it **supplements the label rather than replacing it** — never an icon alone. SF Symbols through `expo-symbols` with a Material Symbol on Android, exactly as `SearchCapsule`'s magnifier already works.
- **A collapsible group is marked by a chevron, not by the words "Show"/"Hide".** **Drawn, not typed** — the same reason §0.6 already gives for rating marks: a glyph's size varies by typeface, so a typed chevron looks broken somewhere. It rotates to show state, needs no translation, and drops a word from a row that is otherwise pure structure.

Unchanged, and deliberately: the save control stays filled inverted ink (§10), the Logged/Planned chip and `‹ Cancel` keep the treatments agreed during M1d, and the `carried ×` chip stays a filled chip on `border` with its `×` behind a divider.

---

## 1. Product & principles

Ponor is a hobby project, published free, for divers who find existing log apps fiddly. It replaces the paper logbook for manual logging: dive count, sites, conditions, gas, gear, and notes. It is not (yet) a dive-computer companion — the schema leaves room for that later. There is deliberately **no trip entity** to create or manage: carry-over prefill covers a trip's shared details, and the dive list groups itself into trips by date and place.

- **Log a dive in under a minute.** Every new dive is prefilled from the previous one. Logging dive #2 and #3 of a trip means changing the depth, the time, and the pressures — nothing else.
- **Only the fields you use.** Everything is optional except the date. Field groups collapse, and any group can be hidden permanently in settings.
- **The map grows itself.** Dive sites and centers are a shared, community-built database. Autocomplete keeps names consistent; fuzzy matching stops duplicates; optional GPS pins put dives on a map.
- **Works at sea.** The whole app runs offline from on-device SQLite. An account is only needed to back up, sync a second device, and contribute named sites — and syncing happens by itself.

## 2. The fast-logging system

The core of the product. Four mechanisms work together.

### 2.1 Carry-over prefill

**Carried over from the last dive:** dive center and site · entry (shore/boat) · salinity and water body · cylinders (material, size, count, working pressure) · gas mixture per cylinder (O₂/He %) · weights · suit, hood, gloves, boots · buddy and guide.

**Fresh every dive:** max and average depth · duration · time in · starting **and** ending pressure · visibility · temperatures · waves/current/surge · rating · title · notes · the exact GPS point (`latitude`/`longitude`).

The GPS point is fresh for the same reason the pressures are: the *site* carries, which is the right granularity, but the exact entry position is a claim of precision that a stale value would make falsely. A carried-over pressure or pin looks like data and is not.

- **Derived automatically:** the dive number (§2.5); the date stays on the previous dive's date when that dive was **today or yesterday** — never when it is dated ahead of today, because a dive that has not happened yet is not recent (§10); used pressure = start − end; surface interval from the previous dive; RMV in l/min when average depth, time, and cylinder size are present.
- **Site defaults:** picking a site prefills entry, salinity, and water body from the site's own defaults — and those win over carry-over when you switch sites.
- **Gear presets:** named equipment sets ("cold water", "tropical") apply the whole cylinders + suit + weights block in one tap.
- **The app learns:** pickers order options by your usage frequency, so your usual cylinder, weights, and suit sit on top without any setup.
- **Duplicate dive:** any past dive can be copied as a starting point.

### 2.2 Progressive form

One scrollable form. A small core strip is always visible: **date, site, center, max depth, duration**. The rest lives in collapsible groups — *Times & depth · Conditions · Gas & cylinders · Equipment · People · Notes & rating*. A "Fields I use" screen in settings hides whole groups for users who never fill them. Only the date is required.

### 2.3 Autocomplete that builds the database

- Typing a site or center searches **your own history first**, then the on-device copy of the community catalogue — both instant and fully offline. Live search adds anything newer when online.
- Creating a new site asks only for a name; country is inferred, and a GPS pin can be set from the map or "use my location" — pressed right on the boat.
- Before saving a new entry, a fuzzy check suggests near-matches: *"Did you mean Shark Point?"* One tap picks the existing site instead.
- Buddies and guides autocomplete from your own past entries only — they stay private text, not user accounts.

### 2.4 Prepare before, finish after

Logs can be half-written in advance. On the boat, set up the coming dives — date, site, cylinder, starting pressure — and they wait at the top of the list as *Up next*, excluded from stats and dive numbering. After surfacing, *Complete dive* asks only for the missing numbers: duration, depths, ending pressure. A planned dive has no dive number until it's completed.

### 2.5 Dive numbering

**Dive numbers are computed, never stored:** chronological position plus your pre-Ponor dive count (`dives_before`, asked once at onboarding, editable in settings any time). Backfilling an old dive slots it into place and renumbers everything after it automatically — on every device, with zero sync churn. Same-day dives order by time in. When times are missing the diver can order them by hand, which is what `manual_order` stores — a nullable integer used only as a tie-break within one date, and **reordering rewrites the whole day as 1..n** rather than writing a position onto the dragged dive alone (see §10). A dive that has been ordered by hand sorts before one that has not, on the same reasoning as timed-before-untimed; dives with neither fall back to creation order, which is deterministic across devices and is almost always already correct. No per-dive number override in v1 (layer it on later only if real users ask).

## 3. Screens

Four tabs plus a full-screen dive form. Onboarding is two steps — pick units and, for switchers, how many dives you already have; optionally sign in — then straight to "Log your first dive".

- **Dives** — auto-grouped into trips (same dive centre, gaps up to 3 days — §10); planned dives pinned on top as "Up next" **with their date**; search; row = number, site, metadata, and the depth value as the row's anchor (§0.6); hand-ordering behind a day strip; logging a dive is the screen's primary action — a bottom-right "+" while Ponor is tab-less, moving into the top-right capsule when the tab bar lands (see below).
- **Map** — clustered pins of your dives (badge = count per site); tapping a site shows your dives there with a depth/temp summary; toggle to explore all community sites.
- **Stats** — total dives, hours underwater, deepest dive; countries and sites visited; RMV trend; currency (days since your last dive, refresher nudge after 6 months); charts later, counters first.
- **Settings** — units (m/ft, bar/psi, °C/°F, kg/lb), language; "Fields I use", gear presets; certification wallet (agency, level, card number); account & sync, data export (CSV + JSON), delete account.
> **Tabs go to the bottom; search and `+` move to a top-right capsule** (owner's call, recorded during M1d, to be built with Settings). Measured on iOS 26, not recalled: Messages (no tab bar) floats a search capsule at the bottom with compose top-right; Photos (tab bar) puts its `[Library | Collections]` capsule bottom-left and search as a detached circle bottom-right. Both are a capsule left, a circle right — exactly the shape Ponor already uses for search and `+` — so the strip holds two objects and we will want three. Calendar answers it: one top-right glass capsule carrying view-toggle, magnifier and `+` as equal monochrome glyphs, with the bottom left to navigation. Ponor follows that. Rejected: keeping `+` bottom-right and hiding search behind a pull-down — more code, and a hidden affordance, which is the same complaint that already cost the reorder control a redesign.
>
> The cost is real and accepted: the `+` leaves the thumb zone §0.5 reserves for the primary action, and stops being big. It is not abandoned — the empty state still puts a full-size "Log your first dive" in the bottom third, so the diver who most needs reach keeps it, and the top-right capsule serves the returning diver with a populated list. Whether `+` is an equal glyph or carries some emphasis is decided when it is built; §10's "no accent on the `+`" binds either way, since that was about hue, not weight.

- **Tablets** — same app with adaptive layouts: list + detail side by side, map next to the list on wide screens. No separate codebase.

## 4. App stack

| Role | Choice | Why |
|---|---|---|
| Framework | Expo · React Native · TypeScript · `expo-router` | One codebase for iOS, Android, tablets; free tooling; OTA JS updates |
| Local database | `expo-sqlite` + Drizzle ORM | Typed schema, migrations, reactive `useLiveQuery`; the device is the source of truth |
| Forms | `react-hook-form` + Zod | Forms are the heart of the app; validation shared with sync payloads |
| UI | `StyleSheet` driven by the §0.2 tokens · small custom kit · `@react-native-community/datetimepicker` · `SectionList` | No styling framework: NativeWind was tried and removed in M0 (§10). Native date/time pickers (M1d — `@gorhom/bottom-sheet` was never installed; the platform picker turned out to be what "an invalid date cannot be entered" needed, and a sheet buys nothing over it); `SectionList` over FlashList for free sticky trip headers, no extra New-Architecture dependency (§10) |
| Maps | `react-native-maps` + `supercluster` | Apple Maps on iOS, Google Maps on Android — both free on mobile |
| State | Zustand (UI) · TanStack Query (remote search) | Persistent state lives in SQLite, not in a JS store |
| i18n | `i18next` + `expo-localization` | English + Czech from day one |
| Cloud client | `@supabase/supabase-js` + `expo-secure-store` | Auth session in the keychain, not AsyncStorage |
| Crash reporting | `@sentry/react-native` | Free developer tier; familiar tooling |
| Builds & CI | EAS Build + GitHub Actions | Free tier quota plus unlimited local builds |
| Web app (post-release) | `react-native-web` via Expo · MapLibre | Same codebase in the browser; free static hosting; maps swap to MapLibre + OSM tiles |

**Development builds, not Expo Go:** maps and Sign in with Apple are native modules, so we build with `expo-dev-client` from the start. Slightly more setup in M0, no surprises later.

**The web app** comes from the same codebase — Expo Router already targets the browser. Two platform splits are expected: maps (MapLibre with free OSM tiles instead of `react-native-maps`) and storage (the browser starts in online mode against Supabase; a local cache can follow). It ships right after the store release, hosted free as a static site, and the future admin area lives inside it.

### 4.1 One owner per rule

This project's defining defect is one rule written in two places, then drifting. It has produced dive numbers reading #2, #1, #3; a date contract asserted three ways at three strictnesses and enforced in none; a site name that said "Unnamed site" in the list and nothing at all on the detail; a cylinder material rendered "Steel" on one screen and "steel" on the next; and, twice, a *Complete dive* button wired to the plain edit route, completing nothing while saying it did. Every one shipped green.

**Each of these owns its class of rule. A second implementation is a defect, not a style preference:**

| Owner | Owns |
|---|---|
| `domain/datetime.ts` | Every reading of a `YYYY-MM-DD` or `HH:MM` string, and every conversion to or from a `Date`. Never `toISOString()` (UTC) and never `new Date('2026-08-31')` (UTC midnight) outside it — three separate bugs came from exactly those. |
| `format/display.ts` | Every conversion of a stored value into diver-facing text. |
| `theme/styles.ts` | Every place a token meets a style property. `theme/depth.ts` is the only reader of the depth scale; `theme/resolve.ts` the only reader of the token sets. |
| `domain/diveNumber.ts` | Dive ordering and numbering (§2.5). |
| `domain/trips.ts` | Trip grouping (§3). |
| `db/dives.ts` | Every write, and the `undefined` = don't touch / `null` = clear patch contract. |
| `src/testing/` | Shared test guards, so a guard cannot be broken in one copy and sound in four others. |

**Two rules keep it that way.**

*Derive, or tie at compile time.* A list that can be computed from another is computed — `FRESH_FIELDS` is the schema's keys minus `CARRIED_FIELDS`, not a second list. One that cannot be gets a type-level assertion that fails the build when the two diverge; `TankFormFieldsMatchTank` and `StatusFormValuesMatchDive` in `diveFormSchema.ts` are the pattern to copy. Adding a member to a hand-maintained option list used to produce a save-blocking rejection and a missing chip, silently.

*One deliberate exception, until i18next.* Roughly twenty-five field labels are duplicated as literals across the form and the dive detail — "Water temp", "Max depth", and so on. They agree today, and each is one edit from becoming the `O2 %` / `O₂` drift again. They are **not** unified yet on purpose: translation has to key every one of them, and that pass is where the set belongs. Doing it twice would be waste; leaving it unrecorded would make it look like an oversight.

*A deliberate near-duplicate names its siblings.* Some rules look alike and answer different questions, and unifying them is itself a bug. Three read a dive's place: `tripKeyOf` groups (centre first, **may be null**, so "no place recorded" stays distinguishable from a dive actually named "Unnamed site"), `diveSiteLabel` displays (site first, **never null**, because a row with no heading is a blank line), and `ReorderControls`'s `rowLabel` speaks (**omits** the placeholder, because position already identifies the row and "Unnamed site" would be noise in speech). Each carries a note naming the others and the question each answers. Without that note, the next reader sees three copies of one rule and helpfully unifies them.

## 5. Backend on Supabase

One Supabase project (EU region, Frankfurt) provides everything server-side; we write SQL and policies, no server code and no hosting. Row-Level Security is the security model: dives are readable and writable only by their owner; sites and centers are readable by everyone.

- **Auth:** Sign in with Apple, Google, and email one-time code. Apple is mandatory once Google is offered (App Store rule 4.8), and email codes beat magic links on mobile.
- **PostGIS** stores site coordinates and answers "sites near me"; **pg_trgm** powers fuzzy autocomplete and duplicate detection — the map and the dedupe are features of the database, not app code.
- **Community model:** any signed-in user can add a site or center; rows are never hard-deleted. Bad entries are fixed by an admin setting `status` to `merged` with `merged_into` pointing at the survivor. Dives store a name snapshot, so history never breaks.
- **One canonical record per site:** the creator and the admin edit its facts (pin, entry, salinity, site depth); everyone else taps *"suggest a correction"*, which lands in a review queue. Divers who disagree with a pin still get precision — a dive can carry its own optional GPS point, and the personal map prefers it.
- **Offline dedupe:** the compact site/center catalogue syncs to every device (all of it while the community is young, country-scoped once it isn't), so autocomplete works fully offline. When a site created offline is pushed, the server reruns the fuzzy check and flags likely duplicates for a one-tap merge by the creator — admin merge is the backstop.
- **Seeding, later:** the catalogue is community-grown first. Open data can top it up one day — Wikidata is CC0 and safe to mix; OpenStreetMap has good dive-center coverage, but its ODbL share-alike would commit the catalogue to an open license. A deliberate decision for later.
- **RPC functions** (Postgres, callable from the client): `search_sites`, `similar_sites`, `suggest_site_edit`, `pull_changes`, `push_changes`, `delete_account`. No Edge Functions needed for v1.

**Free-tier caveat:** free projects pause after 7 idle days. A weekly GitHub Action pinging a health endpoint keeps it warm during quiet months; once there are real users, the problem disappears — and the app works offline regardless.

**Admin in v1 is Supabase Studio.** The merge and suggestion queues are just tables to review there, and usage stats (users, dives per week, new sites) are SQL views. A real `/admin` area arrives with the web app and reuses its codebase.

## 6. Data model

The same schema lives in SQLite (Drizzle) and Postgres. Conventions: **SI units stored**, converted at display · IDs are **client-generated UUIDv7**, so offline creation never needs re-mapping · every column nullable except `id`, `user_id`, `date` · all synced tables carry `created_at`, `updated_at` and `deleted_at` (tombstone). `created_at` is not bookkeeping: dive numbering uses it as an ordering tier for same-day dives with neither a time nor a hand-set order (§2.5), so it must be preserved across sync rather than regenerated.

**On `updated_at`:** the client stamps it locally on every write, and §7's `push_changes` restamps it with the server clock from M2 onwards. Until M2 exists there is no server to set it, so an M1 reader should not go hunting for server code — the repository is the only writer. It is load-bearing either way: §7's whole-row last-write-wins is keyed on this column, so a write that changes nothing must not advance it, or the device that did nothing wins the conflict against the device that did something.

**On `tanks` being non-nullable** (the one exception to "everything nullable"): an empty array already means "no cylinders recorded", so a nullable column would add a second way to say the same thing and force every reader to handle both. The column is NOT NULL with a `'[]'` default and the domain type is `Tank[]`, not `Tank[] | null`.

### `dives` — private, one row per dive

| Cluster | Fields |
|---|---|
| Identity | `status` (logged·planned) · `date` · `time_in` · `manual_order` · `duration_min` · `title` · `notes` · `rating` (1–5) |
| Where | `site_id` + `site_name` snapshot · `center_id` + `center_name` snapshot · `entry` (shore·boat·other) · `salinity` (salt·fresh·brackish) · `water_body` (ocean·lake·river·quarry·cave·pool) · `latitude` + `longitude` (optional exact GPS point) |
| Profile & conditions | `max_depth_m` · `avg_depth_m` · `water_temp_c` · `air_temp_c` · `visibility_m` · `waves` (0–3) · `current` (0–3) · `surge` (0–3) |
| Gas & cylinders | `tanks` — JSON array, one entry per cylinder, first = main: `{ material (steel·alu), sizeL, count (twinset = 2), workingBar, o2Pct (21 = air), hePct, startBar, endBar }` |
| Equipment & people | `suit` (none·shorty·wet·semidry·dry) · `hood` · `gloves` · `boots` · `weights_kg` · `buddy` · `guide` |

**On the GPS point:** SQLite has no point type, so a dive's optional exact position is two nullable columns on the device. Postgres composes them into a PostGIS point in M2 — the sync payload carries the pair, and the server owns the geometry. `dive_sites` keeps a single PostGIS `location` because that table is server-authoritative.

**The keys inside `tanks` are camelCase, unlike every column name.** That is deliberate. Column names get a mapping layer — camelCase in TypeScript, snake_case in SQL — but a JSON blob's interior gets none: whatever the app writes is what is stored, and changing it later means rewriting every row *and* re-agreeing with Postgres `jsonb` in M2. camelCase is the lower-friction end, since the app reads these keys directly.

Tanks are one JSON column instead of a child table: they are never queried on their own, and whole-row sync stays trivial. The form shows a single cylinder until "+ add cylinder" is tapped — multi-gas ready without multi-gas clutter.

**Computed in the app, never stored:** the dive number (chronology + `dives_before` offset), used pressure, RMV across all tanks, MOD when diving nitrox, time out, surface interval.

### Other tables

- **`dive_sites`** (community): `name` · `country` · `location` (PostGIS point) · `salinity` · `water_body` · `entry` · `max_depth_m` (site depth) · `created_by` · `status` (active·merged·hidden) · `merged_into`. A site's defaults prefill new dives logged there.
- **`dive_centers`** (community): `name` · `country` · `location` · `website` · `created_by` · `status`.
- **`gear_presets`** (private): `name` + cylinder/gas/suit/weights block.
- **`certifications`** (private): `agency` (PADI·SSI·CMAS·…) · `course` · `card_number` · `issued_on` · `expires_on` (O₂, first aid). Manual entry — agencies expose no public API. Card photos join with v1.1 photos.
- **`profiles`**: `display_name` · `dives_before` · (future `is_supporter`).
- **Local only:** `settings` (units · locale · hidden groups · `dives_before`, syncs to profile) · `sync_state` (`last_pulled_at` · dirty flags).

**Reserved now** so nothing migrates painfully later: `dive_photos` (storage paths per dive), `dive_samples` (UDDF-shaped depth/time series — the real profile chart on the dive detail, once imports land), and `import_source` / `import_id` on dives so future imports from dive computers or other apps can dedupe safely. Until `dive_samples` holds rows for a dive, no curve is drawn for it anywhere — see §0.4.

## 7. Sync protocol

A deliberately small, WatermelonDB-style delta sync — two RPCs, whole-row last-write-wins. Safe here because every private row has exactly one author; conflicts only occur between one person's own devices.

1. **Push.** Rows flagged dirty go up in one transactional `push_changes` call — dives, presets, and any sites or centers created offline. RLS validates ownership; the server stamps `updated_at` and returns canonical rows; the client clears its flags.
2. **Pull.** `pull_changes(last_pulled_at)` returns the user's changed rows plus the compact community catalogue — all of it while the community is small, country-scoped later. The client upserts by comparing `updated_at`; tombstoned rows are removed locally.
3. **Server clock only.** `last_pulled_at` comes from the server's response, never the phone's clock — divers change time zones constantly.
4. **Guest → account.** On first sign-in, local rows get the new `user_id` and push. That one line is the entire "optional account" migration — a payoff of client-side UUIDs.
5. **Triggers.** App foreground, connectivity restored, a debounced 10 s after any save, and pull-to-refresh. A quiet indicator shows pending changes; sync failures never block logging.

## 8. Costs, compliance & risks

| Item | Cost | Covers |
|---|---|---|
| Supabase Free | $0 / mo | 500 MB database, 1 GB storage, 50k monthly auth users |
| Expo EAS Free | $0 / mo | Cloud-build quota, plus unlimited local builds |
| Maps, Sentry, GitHub | $0 / mo | Mobile map SDKs are free; free tiers cover hobby scale |
| Apple Developer Program | $99 / yr | Unavoidable for the App Store |
| Google Play | $25 once | Unavoidable for the Play Store |

The first real bill would be Supabase Pro ($25/mo) when the database nears 500 MB or point-in-time backups become worth having — thousands of active users away. Dive rows are tiny; photos in v1.1 are the thing to watch, hence on-device compression and per-user caps when they land.

**If it ever needs to pay for itself:** a tip jar plus an optional supporter subscription that raises photo-storage caps — the logbook itself stays free forever, and no ads. The groundwork today is a single `is_supporter` flag on the profile; RevenueCat's free tier can handle store billing when that day comes.

### Compliance & privacy

- Sign in with Apple offered (required alongside Google), and **in-app account deletion** via `delete_account` — both hard App Store requirements.
- PII is an email address, nothing more. Data in the EU; RLS on every table; tokens in the device keychain; full data export any time — CSV for spreadsheets, JSON for portability (GDPR Art. 20).

### Risks

- **Sync bugs are the classic trap.** Mitigated by the smallest viable protocol: whole-row LWW, server clock, client UUIDs, tombstones — and integration tests that simulate two devices from day one.
- **Community data gets messy.** Fuzzy dedupe at creation, name snapshots on dives, and admin merge via `status`/`merged_into`. Moderation tooling stays Supabase Studio until the app earns real traffic.
- **Scope creep.** The v1 field set is frozen as written here. Everything else — photos, computer import, the web app, social features, site pages — goes on the shelf after release, not into v1.

## 9. Milestones

- **M0 · Skeleton** — repo, Expo + TypeScript app, dev builds running in a simulator or on a device, lint and CI green. Plus the §0 identity in code: both token sets driving a `StyleSheet` theme, the depth scale, Archivo + IBM Plex Mono loaded, app icon and splash. A weekend.
  *Done when: the app runs from CI-checked code; **the four Archivo weights render visibly different from each other and the IBM Plex Mono rows render monospaced**; and switching the OS between light and dark switches the app with it. **Met 2026-08-29** on the iOS 26.3 simulator. A physical-device pass is worth doing before release but is not an M0 gate.*

  > The typeface criterion is worded that way deliberately. It first read "Czech diacritics intact", which San Francisco renders perfectly — so the check passed while **no embedded font resolved on iOS at all**, and M0 was briefly marked met on evidence that could not fail. Weight difference and monospacing are falsifiable; diacritics are not. Apply the same test to future done-whens: ask what result would *disprove* the claim.
- **M1 · The local logbook** — schema and migrations, the dive form with groups + prefill + duplicate + gear presets, prepare-ahead planned dives, list and detail, units, autocomplete from own history. No account, fully offline — already a usable app.
  *Done when: you log a 3-dive trip in under 3 minutes, in airplane mode.*
- **M2 · Accounts & community** — Supabase project, three sign-in methods, the sync protocol, community sites and centers with fuzzy dedupe, and the Map tab.
  *Done when: a site created offline on "the boat" appears on a second signed-in device's map after sync, and an obvious duplicate gets caught by "did you mean".*
- **M3 · Surface — release** — stats screen, certification wallet, Czech + English, CSV + JSON export, store listings, Sentry wired, TestFlight and Play internal testing, then public.
  *Done when: strangers can install it from both stores for free.*

**Web is pulled forward out of v1.1** (owner's call, during M1d) — but as a **testing target, not a supported platform**: no store listing, no parity promise, and no obligation on later features to work there. The reason it moves is not only that a browser is a faster way to actually use the app than a device build; it is that the blocker lives in the **data layer**, which M2's sync will be built on top of. Finding out at v1.1 that synchronous SQLite-over-a-worker cannot work on web would be expensive; finding out now is cheap. **It works.** A browser build logs, edits and lists real dives out of wa-sqlite in OPFS, and survives a page reload — verified in Chrome, not inferred. The full account is `.superpowers/sdd/web-spike-report.md`; what the data layer learned, and what M2's sync inherits from it:

- **`openDatabaseSync` cannot be the browser's entry point, and no timeout makes it one.** The earlier diagnosis here — a race between a spin-loop budget counted in iterations and a worker still compiling 621 KB of wasm — was wrong about the mechanism and right only about the remedy. A dedicated worker's script is fetched and started *by its parent's event loop*, so the spin loop blocks the very thread that would boot the worker it is waiting for: measured, the main thread span 134 million iterations over 20 seconds and the worker never answered. The main thread has to yield once. `src/db/client.web.ts` opens the database with `openDatabaseAsync` and gates the app on it; every synchronous call after that works, in ~12 ms.
- **Every synchronous result of 256 bytes or more came back truncated** — `patches/expo-sqlite+57.0.2.patch`, an upstream one-line bug in the bridge's length header. This is the finding worth having early: the sync bridge was not slow, it was *wrong*, and saving any dive at all failed on it.
- **A synchronous result over 1 MiB never returns at all.** The bridge's result buffer is 1 MiB, the worker throws while writing past it, and the lock is never released — the app sees "Sync operation timeout", which is not what happened. At ~600 bytes a dive that is a ceiling around 1,700 dives in one `SELECT`, and M2's pull batches must stay under it or page.

Three native-only gaps in the browser, none of them the data layer: `@react-native-community/datetimepicker` ships no web build (`src/components/DateTimeField.web.tsx` uses the browser's own inputs, which keep §10's "an invalid date cannot be entered" for free); `Alert.alert` is an empty function in `react-native-web`, so *Delete dive* opens no dialog and does nothing; and `expo-font`'s config plugin is native-only, so Archivo and IBM Plex Mono never load and the browser draws the whole app in its default serif. The last two are unfixed on purpose — both need an edit to shared native code, which the spike was not authorised to make. `react-native-maps` still has no web support, so M2's Map tab will not render there.

**After release — v1.1 and beyond, roughly in order:** the admin area · photos (compressed on-device, per-user caps) · dive-computer & app import (UDDF / Subsurface / Garmin FIT, a PADI migration, plus UDDF export) · site pages with community aggregates · social last, deliberately: linked buddies and site comments bring App Store moderation duties (reporting, blocking), so they wait until the app has earned them.

**Migrating from the PADI app:** PADI's web logbook talks to a GraphQL API, and community tooling already exports it as JSON/CSV (see [PADI-Logbook-exporter](https://github.com/karnovnik/PADI-Logbook-exporter)) — summary fields only, since PADI stores no depth profiles and rarely a start time. Our importer maps that JSON; a GDPR portability request is the fallback. Real depth profiles come from dive-computer files (UDDF, Subsurface, FIT) and draw the profile chart on the dive detail.

## 10. Decision log

Key decisions and the alternatives they beat — don't relitigate without new information.

- **Supabase over a custom .NET API** (v1): $0 and no ops; plain Postgres underneath, so migrating to self-hosted .NET + Postgres later needs no redesign.
- **No trip entity:** carry-over prefill + auto-grouped list instead; a nullable `trip_id` can be retrofitted (even backfilled by date clustering) if users ask.
- **Tanks as a JSON array on the dive row,** not a child table: never queried independently; keeps sync whole-row.
- **Dive number computed** (chronology + `dives_before` offset), never stored: backfill renumbers for free; no per-dive override until real users ask.
- **Starting pressure is not prefilled** from the previous dive (explicit owner decision).
- **Offline-first with whole-row LWW sync:** acceptable because each private row has a single author.
- **Sign-in optional;** guest → account is just claiming rows (client UUIDs).
- **Email OTP over magic links;** EU region (Frankfurt); SI units stored, converted at display.
- **Photos, web, imports, social deferred** past v1 in that order; social last because UGC brings App Store moderation duties.
- **Named Ponor** (§0): the same word in Czech and English, pronounced identically, and free where it counts — `ponor.app` registered. Beat Slate, Bezel, Sextant, Halocline, Atoll, Manta and Deco, each of which failed an App Store or trademark check.
- **Colour encodes depth and nothing else;** controls stay monochrome. The scale follows the order in which water removes colour, so it carries meaning rather than decoration, and depth is always shown redundantly as a number.
- **Dark and light both ship from M0,** not M3: the token set has to exist before the first screen does, and retro-fitting a theme onto built screens is the expensive path.
- **No styling framework — `StyleSheet` built from the tokens** (revised in M0, replacing NativeWind in §4). NativeWind v5 is the only line supporting React Native 0.86 and it is a preview that does not work: Tailwind's `@theme` needs a PostCSS setup Expo does not run by default, and once wired up `react-native-css` fails to deserialize its own compiled output — the same error breaks Expo's own bundled `@expo/log-box` stylesheet. Verified on a simulator, not inferred. A `makeStyles(scheme)` helper over `tokens.js` costs little and keeps the single-source-of-truth property; revisit when NativeWind v5 is stable.
- **`tanks` JSON keys are camelCase** while every column is snake_case: a JSON interior has no mapping layer, so the casing the app writes is permanent, and changing it after users have rows means rewriting every blob and re-agreeing with Postgres in M2.
- **No CHECK constraints on `rating` or the 0–3 condition scales:** §1's "never block a save" argues against hard database rejections, and a CHECK would also reject a row synced from a future client with a widened range. SQLite CHECKs need a table rebuild to add, so this is recorded rather than left to be re-derived. **The same decision covers the TypeScript types**, which stay `number | null` rather than literal unions (`1|2|3|4|5`, `0|1|2|3`): an M2 sync delivering `rating: 6` from a future client is a runtime reality, and typing it as impossible would make the repository's row-to-domain cast a lie. Narrowing them would also break the schema↔domain drift assertion in `db/dives.ts`, since Drizzle's `integer()` infers `number | null` and cannot be narrowed from the schema side. Range handling belongs at the form boundary — but as a **warning or a correction, never a rejection**: §1's "never block a save" binds the form as hard as it binds the database, and a diver on a boat does not get to argue with a validator. A value outside the expected range is saved and can be flagged; it is not refused. **Half discharged at the end of M1d:** the fixed-option and boolean fields now keep and flag a value they do not recognise rather than refusing the save, which is what a dive synced from a newer client will deliver. **Still owed:** `rating`, `waves`, `current` and `surge` are bare `optionalNumber` in `diveFormSchema.ts` with no range check and nothing to flag one, so nothing is *refused* — §1 holds — but nothing is flagged either. This entry described the flagging as built for the length of M1d and it never was; found by the final review reading the plan against the code in both directions, which is the only way that kind of drift surfaces.
- **Empty numeric form fields must reach the domain as `null` or `NaN`, never `0`.** `Number('')` is `0`, and `derived.ts` classifies `0` as *contradictory* for `sizeL`/`count`, which voids the whole dive's gas figure rather than skipping one cylinder. A bare `z.coerce.number()` calls `Number()` internally, so it silently blanks a dive's RMV the moment a cylinder field is left empty — no rejected form, no flagged field, just a quietly missing gas figure. Every Zod schema for these fields maps an empty string to `null` instead. This binds the first file M1d writes, long before anyone has reason to open `derived.ts`; the full reasoning lives in the `COERCION CONTRACT` block there.
- **One owner for the `YYYY-MM-DD` / `HH:MM` string forms** (`domain/datetime.ts`, added in M1a): the contract was previously asserted in three modules at three strictnesses and enforced in none, so the same stored value got three verdicts — `'7:30'` sorted after `'19:00'` in the list while `timeOut('7:30', 45)` returned null. The rule is now **lenient about spelling, strict about meaning**: a value naming exactly one real date or time is canonicalised however spelled, one naming none is refused, and nothing ambiguous is guessed. Per §1 the write boundary never rejects — it canonicalises what it can, maps a blank `time_in` to null, and stores the rest unchanged; the read side refuses to compute on a value it cannot read rather than mis-computing. Note the deliberate asymmetry for an impossible date like `2026-02-30`: numbering still places the dive where the diver typed it (numbering never refuses to number a dive), while `surfaceIntervalMin` returns null rather than an interval overstated by 24 hours.
- **`manual_order` stays an integer, and a reorder renumbers the whole date** (owner's call, M1a). Fractional indexing was the alternative — writing `1.5` to drop a dive between 1 and 2, which SQLite's INTEGER *affinity* silently permits — but §6 puts the same schema in Postgres, where an `integer` column does not, so a fractional rank would round or error on its way through `push_changes` and, under whole-row LWW, silently change the diver's hand-ordering on sync. The repository therefore exposes `reorderDivesForDate(db, date, orderedIds)` — whose `orderedIds` must name every live **logged** dive on that date, once each — as the only way to change it, and `updateDive` refuses the field: because `manual_order` is a *tie-break* and hand-ordered dives sort before non-hand-ordered ones, writing it onto the dragged row alone — what `onDragEnd` hands you — lifts that row to the top of its group instead of dropping it where the diver let go. Non-integers are rounded rather than rejected, per §1.
- **A local save failure is shown to the diver; a sync failure is not.** §7's "sync failures never block logging" is about the network, and it must not be read as licence to swallow a failed *local* write. A SQLite insert that fails is a real error the diver needs to see, because the alternative is believing a dive was logged when it was not. M1c's save flow awaits the write, surfaces a failure, and does not reset the form as though it had succeeded; the save control also needs an in-flight disabled state, since the repository is safe under concurrency but a double-tap would create two dives.
- **The primary button stays inverted ink and gains no brand accent** (asked and settled in M1c). The depth scale spans six hues across essentially the whole spectrum, so *any* accent on the `+` lands in or beside a band, and a diver scanning the screen would have to decide whether a coloured object is data or chrome — the exact ambiguity §0.1 exists to prevent. Inverted ink is also already the most prominent treatment available. Ponor's brand colour is the depth gradient itself, which lives on the icon and splash where there is no data to confuse it with. If the `+` ever needs more presence the levers are size, shadow and clearance — never hue.
- **Search floats at the bottom, not the top** (§0.6, M1c). At the top it was the brightest object in the app and the furthest control from the thumb — and §0.5 had already said the primary action belongs in the bottom third, which the `+` obeyed and search did not. Three earlier proposals all argued about how *loud* the field should be; the position was the actual problem. The shape was measured off iOS 26 Messages on a simulator rather than recalled, which corrected three wrong assumptions: there is no bar, it does not span the width, and a shadow rather than a border separates it.
- **Computed values are prefixed `=`, not marked with a square** (§0.6, revised during M1c). The first build used a 6 px outlined square, and the owner — who had approved it in the mockups — read it in the running app as a broken glyph rather than a mark. An equals sign says what the value *is*: the result of a calculation. A symbol that needs a legend has already failed; this one needs none.
- **The depth value anchors a dive row** (§0.6, added after M1b). The built screens obeyed the token system without using it — everything one size, the depth colour reduced to a small trailing number — so the palette never actually read. Depth is the value that differs dive to dive and the one the scale exists to encode, so it is the largest thing in the row. Beat giving every row a depth-tinted edge, which would have spent colour on chrome rather than data.
- **The depth scale ends at band 6 and does not gain more hues.** Band 6 is everything from 40 m down, so a 75 m dive renders as one colour. That follows the physics the scale is built on — below roughly 40 m water has stripped all the colour there is — and six bands are frozen in `DepthScale` / `DepthBand`. Charts instead **darken within band 6** as depth increases: same hue, more resolution, still literally true. The number always carries the exact figure, so only the hue saturates, never the information.
- **MOD is per cylinder, and there is no single "dive MOD".** `tanks` is an array and the app is explicitly multi-gas, so a dive with a bottom mix and a deco gas has two limits — 67.8 m and 18.0 m are both true, and averaging them or taking the first is a fiction. (M1b shipped `mod(dive.tanks[0]?.o2Pct)`, which showed one and hid the rest; fixed in M1c.)
- **No "you exceeded your MOD" warning while a dive has more than one gas.** With a single cylinder the check is sound — max depth against that mix's limit. With several it is not, because which mix was breathed at depth cannot be known without gas-switch times, and `tanks` stores none. UDDF carries them, so the warning waits for sample import and stays gated on `tanks.length === 1` until then. Same rule as §0.4: the app does not warn about what it has no data to know.
- **No schematic dive profiles** (§0.4): rows show the coloured depth number, and the sparkline and detail chart appear only for dives carrying a real sample series. An interpolated curve would read as recorded data.
- **`SectionList` rather than FlashList** (M1b; revises §4's UI row). A personal logbook is hundreds of rows, not thousands, so FlashList's extra virtualization headroom buys little; `SectionList` gives the Dives list's sticky trip headers for free, where FlashList would need them hand-rolled; and it ships with React Native itself rather than being another third-party bet on New Architecture support — exactly what cost M0 its NativeWind rewrite, above. Revisit if a real logbook's list ever gets slow enough to need it.
- **Hand-ordering is move-up / move-down, not drag** (M1b, owner's explicit call; implements §2.5). It only ever applies to a handful of untimed same-day dives, typically two or three rows, where arrows are both accessible and testable without simulating a gesture. `reorderDivesForDate(date, orderedIds)` already takes an ordered id array regardless of how the diver produced it, so a drag implementation could replace the arrows later without touching the data layer — the interaction and the write are already independent.
- **A trip is one dive centre, with gaps of up to 3 days** (owner's call, revised during M1d; replaces “consecutive days, same place” in §3). The original rule keyed on the *site* and allowed one day, and both halves broke on the ordinary shape of a diving holiday: a boat day out of Subic visits two to four different wrecks, so one week fragmented into a dozen one-dive “trips”, and a single rest day split whatever survived. The dive centre is the thing that stays constant across a trip's sites, and carry-over prefill (§2.1) keeps it filled without retyping, so grouping on it is both correct and free. Because the centre *is* the grouping key, every dive in a trip shares it by construction — so the header is simply the key, with no “most-dived site” heuristic and no “5 sites” fallback to invent. A dive with no centre still falls back to its site, so shore diving groups exactly as it did before. Rejected: dropping the place condition entirely (a week of local diving merges into one meaningless group); and a site hierarchy putting every Subic wreck under “Subic”, which needs a region level that neither the local schema nor §6's `dive_sites` has — that waits for the community catalogue in M2.
- **"Up next" is distinguished by ink, not by shape** (§0.6, added during M1d). Rendered identically to a trip header it said the two were the same kind of object, when one is a filed record and the other a live queue of dives still to come (§2.4). The discriminator in code is an explicit `variant` prop, never `title === 'Up next'` — that string is a label bound for i18next (en + cs), and a rule reading it would stop firing silently the day it becomes `Další v pořadí`. Same reason `splitPlanned` keys on `status`, not on a display string.
- **Date and time are pickers, so an invalid value cannot be entered** (owner's call, M1d). This resolves an open tension rather than splitting it: `date` carried the form's only blocking rule, so a mistyped date was the one thing that could refuse a save — squarely against §1 — while §10's own range decision says the form warns and never rejects. Both answers on the table were bad: keep rejecting and contradict §1, or accept an unparseable date and hand the domain a value it cannot compute on. A picker removes the case instead of adjudicating it. `timeIn` gets the same treatment for a quieter version of the same defect — a typo there does not block the save, it silently drops the dive out of time-ordering and voids its surface interval. **The Zod rules stay** as the domain's backstop: the UI can no longer produce a bad value, but M2 sync will deliver rows this form never touched, and removing a guard because one of its callers got safer is not the same as removing dead code. The stored form is still the `YYYY-MM-DD` / `HH:MM` string — `domain/datetime.ts` remains its only owner, and the `Date` the picker returns is converted there from LOCAL components, never `toISOString()`, which would store the UTC day and shift any dive logged late in the evening east of Greenwich to the day before.
- **A dive's status changes in exactly one place: the form's own Logged/Planned control** (M1d, closing §2.4). Every *consumer* of a planned dive shipped first — "Up next", exclusion from numbering, the *Complete dive* pill, the completion flow — while the producer was never built, so no diver could create one and the planned dive in the dev database was seed data. The control is a plain form field, which is what makes the rest fall out: the patch names `status` exactly when the diver moved it, so **editing a planned dive leaves it planned and flipping the control to Logged *is* completing it**, one control doing both jobs. What it replaces is a rule inside the form that logged any planned dive it was handed — found by using the app: correcting a typo in a planned dive's site name silently completed the dive. *Complete dive* therefore passes the state the control should **open** on through the route (`openAs`), never a second write path from the list. Two consequences worth stating: **the heading reads what the save will do**, not what the dive is, so "Complete dive" appears only when the control is on Logged over a stored plan (it used to be permanent, and true only because the save quietly made it so); and the control is §0.6's quiet chip vocabulary in the form's header row, deliberately **not** a sixth field in §2.2's core strip, because a status is not one of a dive's measurements. **A planned dive's date is not constrained** in either direction — a plan becomes past-dated by the clock moving (plan three dives on a boat, do two, and at midnight the third is past-dated with no diver involved), so a minimum date would be a rule time itself violates.
- **A destructive confirmation is OS chrome; the app's own control stays muted** (M1d, deleting a dive). §0.1 reserves colour for depth, which leaves nothing to make "Delete dive" look destructive — and a plain muted label is exactly right for a control you should not hit by accident. The weight goes into the platform `Alert` that follows, whose `destructive` button is red because iOS draws it that way. The app's surfaces stay monochrome and the diver still gets the standard danger signal, on the same reasoning that lets the keyboard be full of system colour. Deletion is **soft**: the row survives with `deleted_at` set, because M2's sync needs the tombstone — a hard delete would satisfy a "the dive is gone" test and silently break sync later. That test existed and passed against a hard `DELETE`; it now asserts the surviving row.
- **A dive's own actions: *Edit* in the top bar, *Complete dive* and *Delete dive* at the end of the content** (owner's call, M1d). The top-right action is *Edit* for every dive, planned or logged, and always opens the form on the dive's own status. The two acts that change what a dive *is* group at the end of the content, where *Delete* already sat deliberately rather than beside *Edit*. What this replaces: a single top-right control that read "Complete dive" over a plan, which left a diver fixing a typo with no button matching their intent. Completing does not get quieter — the prominent pill on the "Up next" row is the on-the-boat path and is untouched. *Complete dive* wears §0.6's bordered pill, the same treatment this same action already has on that row; it is not destructive, so it does not borrow *Delete*'s plain muted label, and it is not the screen's primary action, so it is not the filled button. **The recurring defect here is a label and a link that disagree** — twice a "Complete dive" control was wired to the plain edit route, completing nothing while saying it did. A test naming only the labels passes with the two routes swapped, so the assertion that counts is which href each control sends.
- **Two §1 edges that only become reachable when sync does** (recorded at the end of M1d, to decide in M2, not before). First: a dive arriving from a newer client with a `status` this build does not recognise. The other unknown values are now kept and flagged, but `status` cannot be — it is non-nullable (§6) and drives `splitPlanned`, dive numbering and "Up next", and the form's control is two-state, so there is no way to show it without choosing one. Refusing the save breaks §1; choosing silently rewrites the diver's data. Decide it against a real sync payload rather than in the abstract. Second: a kept-but-unrecognised option value renders as **nothing** on the dive detail — `formatEntry` and its siblings return null for a value they do not know, so the row is simply omitted. That makes "flagged" only half true today: the value survives the round trip but the diver cannot see it. Both are unreachable until M2 delivers a payload this client did not write.
- **`carryOverDate` broke twice, and both times its tests agreed with it** (M1d). Six lines, two defects. First it compared a real instant against a UTC-midnight calendar value, so §2.1's window was 48 h *plus the device's UTC offset* — a dive two days old in Manila still carried its date forward. Fixed, and then the same function shipped a one-sided comparison: a previous dive dated in the **future** produced a negative difference, which is also "less than a day", so completing a dive planned for next week made every later dive default to next week. Both were found on a device, not by the suite, and in each case the existing tests had been written to match the behaviour rather than the intent — the second fix had to rewrite four tests that were standing on the bug, one of which used the year 2099 precisely because the window had no near end. The lesson is not about dates: **a test written after the code, from the code, agrees with the code.** The window is now stated as a closed interval — today or yesterday — because "less than 48 h old" is the phrasing that hid both halves.
