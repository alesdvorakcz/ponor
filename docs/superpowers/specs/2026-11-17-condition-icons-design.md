# Condition icons (#6) — design

> Designed with the owner on the design canvas (*Dive app design system*, find it with `/artifacts`),
> page *Work in progress*, 2026-11-16/17: eight categories reviewed one by one, then the whole
> *New dive* and *Dive detail* drawn top to bottom (strip *Together*) as the target picture.
> This document records what was decided, for the build.
>
> **Stacked on #31** (PR #62): this branch starts from `issue-31-site-centre-fields` because the
> site types, a site's entry as a set, and the New dive site page are #31's. It is rebased onto
> `main` once #62 merges, and its PR targets `main` from then on.
>
> Status: approved on the canvas category by category; this written form pending the owner's OK.

---

## 1. Why

DESIGN.md §9 has owed "a drawn icon set" since M1h: the scales shipped with SF Symbol marks that
passed §0.6's test and were still not good enough to keep, so they came out, and only *Entry*'s
shore and boat kept a symbol. The owner's objection was never to icons. It was that SF Symbols are
not this app's hand. This is that set, drawn for Ponor, plus the places it is used.

## 2. What is decided

**The style (§0.6 gets it).** Line drawings on a 40 × 40 grid, one ink, no fills. Main stroke 2.0,
detail stroke 1.35, round caps and joins, as the Dives tab mark. Shared grid for the water scenes:
a 3 pt margin, the water surface at y 22, the bed at about y 35, the same surface wave and
sub-ripple everywhere. A shape may be *knocked out* (filled with the ground it sits on) so lines
behind it disappear; a knock is the tile's own colour, never a second ink.

**The set, by field.**

| Field | Values with a drawn icon | Words only |
|---|---|---|
| Entry | shore, boat | other |
| Water body | ocean, lake, river, quarry, cave, pool | — |
| Weather | sunny, cloudy, overcast, rainy, windy, foggy | — |
| Waves | flat, small, medium, large (one icon per level: height is the scale) | — |
| Visibility | one icon for the field (the mask) | the level stays a word |
| Current | one icon for the field (streamlines); *None* is the same lines dashed, no heads | the level stays a word |
| Surge | one icon for the field (two swing arcs); *None* dashed, no heads | the level stays a word |
| Cylinder configuration | single, twinset, sidemount (the harness) | — |
| Suit | shorty, wet, semidry, dry (hoods on semidry and dry) | none |
| Site type (#31) | wreck, reef, wall, pinnacle, canyon, swim-through, muck (the seahorse), drift, blue water | — |
| Salinity, material, weighting | — | all |

**Figure glyphs**, drawn in the same hand: *max depth* (an arrow from the surface to the floor)
and *average depth* (the arrow stops at a level halfway; the floor below is dashed). They are never
profile curves (§0.4). Times and temperatures get none: a clock or a thermometer only repeats the
label.

**Where they appear.**

- **Dive form:** entry, water body, weather, waves, configuration and suit become **tile pickers**:
  icon over label, 3 columns (waves 4), 88 pt tall (waves 80), chosen = inverted. Visibility,
  current, surge, material, salinity and weighting stay **word chips**. Max and average depth rows
  lead with their glyphs.
- **Dive detail:** the conditions become **tiles** in a 3-column grid under the map card:
  entry, water body, weather, waves, visibility, current, surge, suit. Each tile is the icon,
  the value, and the field name in small caps. Visibility, current and surge show their
  field's icon over the level word, so *None* has an icon too (the dashed one). The suit tile
  carries its thickness (*Wet · 5 mm*). Temperatures and the visibility distance stay rows.
  Max and average depth rows lead with their glyphs, and the figures keep their band colour.
  **The rating** becomes the drawn dots the list row and the form already use, not
  *4 / 5* (owner, 2026-11-17).
- **Site (#31):** on *New dive site*, site types and the site's entry options become multi-select
  tiles, and water body becomes single-select tiles. On the site page they show as tiles where #31
  prints a line of text. Salinity stays a word row until #53 decides it.

**Deliberate departure, recorded in §10:** visibility, current and surge carry *one icon per
field* with the level in words. §0.6 says an icon belongs to a value with a shape. These icons mark
the field rather than the value. The owner rejected every per-level drawing (round 2), and a bare
word in a row of icon tiles would break the row.

## 3. Not in #6

- *On this dive*, Night, Training, the altitude glyph, entry offered from the site's options, and
  the folded *Water & entry* are #63's. The icons are drawn, but nothing uses them until #63.
- The equipment rows stay today's five Yes / No rows; your own gear is #58.
- Salinity following the water body is #53.
- Moving the settled boards from *Work in progress* to the group pages is canvas work done
  alongside, not code.

## 4. Approaches

**Drawing the icons.**

1. **The drawings as data, one component** *(picked)*. A TypeScript module holds every icon as a
   list of path elements with their role (line, detail, knock, dot, scaled group), and
   `ConditionIcon` renders a name with `react-native-svg` (already a dependency) at a size, in an
   ink, on a ground. One owner of stroke widths and knocks. The canvas drawings port verbatim.
2. SVG files in `assets/` loaded through a transformer. This needs new build tooling, and a file
   cannot take the ground colour a knock needs, so knocks would have to be a second ink.
3. One component per icon. About 70 components each carrying its own stroke widths: exactly the
   duplication §4.1 exists to prevent.

**The tile pickers.**

1. **A tile layout on the existing chip components** *(picked)*. `OptionChips` (single choice)
   and `TokenChips` (a set) gain `layout="tiles"` and an `iconFor(option)`. Selection, tap-to-clear,
   the carried mark and clear, accessibility and the 48 dp floor stay in one owner each, and only
   the drawing changes.
2. A separate `TilePicker`, which would be a second copy of every rule `OptionChips` already
   states.

## 5. Rules the build keeps

- An icon **supplements its label, never replaces it** (§0.6). A tile always has its word.
- The icon takes the ink of its label: inverted with the tile when chosen, like `EntryIcon` today.
- A token the vocabulary does not know (a newer client's value, §10's store-and-flag) draws no
  icon and keeps its word. A value without a drawing is a deliberate absence, not an omission.
- No hue anywhere (§0.1): icons, tiles and glyphs are ink; only the depth figures keep their band.
- 48 dp floor on every tile. Czech is the long language: the longest labels (*Jedna láhev*,
  *Polosuchý*, *Skalní věž*, *Modrá voda*) must fit a third of 393 pt without wrapping.
- `EntryIcon`'s SF Symbols retire; `symbolName` stays for the tab bar and the rest.

## 6. Done when

- Every value in the table above draws its icon in both themes and both languages, on the form,
  the dive detail and #31's site screens, and every words-only value draws none.
- The depth rows carry their glyphs, and the detail's rating is dots.
- DESIGN.md §0.6 states the set and the rules, §10 records the one-icon-per-field departure, the
  dashed *None*, and the detail's rating dots, and §9 drops the owed item. CLAUDE.md's
  "Ponor Reference has 18 screens" is corrected.
- CI's checks pass (`npm run typecheck && npm run lint && npm test -- --ci`), and the screens are
  checked on an iPhone simulator, dark and light, English and Czech.

## 7. Left to the builder

File names and module layout. Tile height per field if a real device disagrees with the canvas.
How the icon data is produced: ported once and committed as data, with no generator in the repo.
