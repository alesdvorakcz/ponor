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

### 0.5 Constraints the design must answer

- **Sunlight.** Dives are logged on an open deck at noon. The light theme exists for this; contrast is a functional requirement, not a taste question.
- **Wet hands, one thumb.** Tap targets never below 48 dp, and the primary action sits in the bottom third of the screen.
- **Czech runs 20–30 % longer** than English. Labels wrap to two lines rather than truncate.

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

**Fresh every dive:** max and average depth · duration · time in · starting **and** ending pressure · visibility · temperatures · waves/current/surge · rating · title · notes.

- **Derived automatically:** the dive number (§2.5); the date stays on the previous dive's date when it is less than 48 h old, otherwise today; used pressure = start − end; surface interval from the previous dive; RMV in l/min when average depth, time, and cylinder size are present.
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

**Dive numbers are computed, never stored:** chronological position plus your pre-Ponor dive count (`dives_before`, asked once at onboarding, editable in settings any time). Backfilling an old dive slots it into place and renumbers everything after it automatically — on every device, with zero sync churn. Same-day dives order by time in, or by hand when times are missing. No per-dive number override in v1 (layer it on later only if real users ask).

## 3. Screens

Four tabs plus a full-screen dive form. Onboarding is two steps — pick units and, for switchers, how many dives you already have; optionally sign in — then straight to "Log your first dive".

- **Dives** — auto-grouped into trips (consecutive days, same place); planned dives pinned on top as "Up next"; search; row = number, site, depth · time chips, rating; big "+" button as the app's main gesture.
- **Map** — clustered pins of your dives (badge = count per site); tapping a site shows your dives there with a depth/temp summary; toggle to explore all community sites.
- **Stats** — total dives, hours underwater, deepest dive; countries and sites visited; RMV trend; currency (days since your last dive, refresher nudge after 6 months); charts later, counters first.
- **Settings** — units (m/ft, bar/psi, °C/°F, kg/lb), language; "Fields I use", gear presets; certification wallet (agency, level, card number); account & sync, data export (CSV + JSON), delete account.
- **Tablets** — same app with adaptive layouts: list + detail side by side, map next to the list on wide screens. No separate codebase.

## 4. App stack

| Role | Choice | Why |
|---|---|---|
| Framework | Expo · React Native · TypeScript · `expo-router` | One codebase for iOS, Android, tablets; free tooling; OTA JS updates |
| Local database | `expo-sqlite` + Drizzle ORM | Typed schema, migrations, reactive `useLiveQuery`; the device is the source of truth |
| Forms | `react-hook-form` + Zod | Forms are the heart of the app; validation shared with sync payloads |
| UI | `StyleSheet` driven by the §0.2 tokens · small custom kit · `@gorhom/bottom-sheet` · FlashList | No styling framework: NativeWind was tried and removed in M0 (§10). Native-feel pickers, smooth long lists |
| Maps | `react-native-maps` + `supercluster` | Apple Maps on iOS, Google Maps on Android — both free on mobile |
| State | Zustand (UI) · TanStack Query (remote search) | Persistent state lives in SQLite, not in a JS store |
| i18n | `i18next` + `expo-localization` | English + Czech from day one |
| Cloud client | `@supabase/supabase-js` + `expo-secure-store` | Auth session in the keychain, not AsyncStorage |
| Crash reporting | `@sentry/react-native` | Free developer tier; familiar tooling |
| Builds & CI | EAS Build + GitHub Actions | Free tier quota plus unlimited local builds |
| Web app (post-release) | `react-native-web` via Expo · MapLibre | Same codebase in the browser; free static hosting; maps swap to MapLibre + OSM tiles |

**Development builds, not Expo Go:** maps and Sign in with Apple are native modules, so we build with `expo-dev-client` from the start. Slightly more setup in M0, no surprises later.

**The web app** comes from the same codebase — Expo Router already targets the browser. Two platform splits are expected: maps (MapLibre with free OSM tiles instead of `react-native-maps`) and storage (the browser starts in online mode against Supabase; a local cache can follow). It ships right after the store release, hosted free as a static site, and the future admin area lives inside it.

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

The same schema lives in SQLite (Drizzle) and Postgres. Conventions: **SI units stored**, converted at display · IDs are **client-generated UUIDv7**, so offline creation never needs re-mapping · every column nullable except `id`, `user_id`, `date` · all synced tables carry `updated_at` (server-set) and `deleted_at` (tombstone).

### `dives` — private, one row per dive

| Cluster | Fields |
|---|---|
| Identity | `status` (logged·planned) · `date` · `time_in` · `duration_min` · `title` · `notes` · `rating` (1–5) |
| Where | `site_id` + `site_name` snapshot · `center_id` + `center_name` snapshot · `entry` (shore·boat·other) · `salinity` (salt·fresh·brackish) · `water_body` (ocean·lake·river·quarry·cave·pool) · `latitude` + `longitude` (optional exact GPS point) |
| Profile & conditions | `max_depth_m` · `avg_depth_m` · `water_temp_c` · `air_temp_c` · `visibility_m` · `waves` (0–3) · `current` (0–3) · `surge` (0–3) |
| Gas & cylinders | `tanks` — JSON array, one entry per cylinder, first = main: `{ material (steel·alu), size_l, count (twinset = 2), working_bar, o2_pct (21 = air), he_pct, start_bar, end_bar }` |
| Equipment & people | `suit` (none·shorty·wet·semidry·dry) · `hood` · `gloves` · `boots` · `weights_kg` · `buddy` · `guide` |

**On the GPS point:** SQLite has no point type, so a dive's optional exact position is two nullable columns on the device. Postgres composes them into a PostGIS point in M2 — the sync payload carries the pair, and the server owns the geometry. `dive_sites` keeps a single PostGIS `location` because that table is server-authoritative.

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

**After release — v1.1 and beyond, roughly in order:** the web app (same codebase, and home of the admin area) · photos (compressed on-device, per-user caps) · dive-computer & app import (UDDF / Subsurface / Garmin FIT, a PADI migration, plus UDDF export) · site pages with community aggregates · social last, deliberately: linked buddies and site comments bring App Store moderation duties (reporting, blocking), so they wait until the app has earned them.

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
- **No schematic dive profiles** (§0.4): rows show the coloured depth number, and the sparkline and detail chart appear only for dives carrying a real sample series. An interpolated curve would read as recorded data.
