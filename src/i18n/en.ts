import type {
  Configuration,
  ConditionLevel,
  DiveStatus,
  Entry,
  Equipment,
  Salinity,
  Suit,
  TankMaterial,
  Visibility,
  WaterBody,
  Weather,
  WeightsFeel,
} from '../domain/types';
import type { UnitSystem } from '../format/units';

/**
 * **English, and it is not a translation of Ponor — it is Ponor.**
 *
 * Every string below was lifted verbatim out of the module or screen that used to hold it as a
 * literal; not one English word changed in the move, which is the only thing that makes this
 * diff reviewable against the app that shipped before it. Anything that reads wrong here read
 * wrong before, and the place to fix it is a separate change.
 *
 * This file is also the **shape** of `cs.ts`: `i18n/index.test.ts` walks both and requires the
 * same key set on each side, plural suffixes normalised away, so a key added here without a
 * Czech word fails a gate rather than silently falling back for ever (§1's "never block" is
 * about a *diver*, not about us).
 *
 * **Every closed vocabulary is tied to `domain/types.ts` at compile time** (`satisfies
 * Record<Entry, string>` and its siblings). §4.1's rule is "derive, or tie at compile time",
 * and this is where translation could have quietly broken it: `format/display.ts` used to read
 * these values through one shared `capitalize`, so a new member of `ENTRY_VALUES` capitalised
 * itself and needed nothing here. Words cannot be derived, so the tie takes over — adding a
 * value to a vocabulary is now a type error in this file and in `cs.ts` until somebody names
 * it in both languages.
 *
 * **Plurals are i18next's, and Czech has four forms where English has two** (§0.5). A key that
 * takes a count is written `_one`/`_other` here and `_one`/`_few`/`_many`/`_other` in `cs.ts`;
 * `Intl.PluralRules` picks between them, so nothing in this app compares a count with 1.
 *
 * **A count phrase is not always composable, and Czech is what proves it.** English embeds
 * "5 dives" into a sentence unchanged; Czech governs the noun's case from whatever stands in
 * front of it, so *"posledních 5 ponorů"* needs a different form of the same noun than *"5
 * ponorů"* does. Where a sentence embeds a count it therefore carries its own plural forms
 * (`stats.rmvWindow`) rather than interpolating `format/display.ts`'s standalone phrase. That
 * is not a second owner of the plural rule — i18next owns it, once — it is the same rule
 * applied to a different noun form.
 */
export const en = {
  translation: {
    /**
     * The four tab labels (`navigation/tabs.ts`). Two of the four screens behind them are still
     * English; the bar is one object and half of it in each language would be worse than either.
     */
    tabs: {
      dives: 'Dives',
      map: 'Map',
      stats: 'Stats',
      settings: 'Settings',
    },

    /**
     * Every closed vocabulary a form offers (`domain/types.ts`), as the word a diver reads.
     * `format/display.ts` is still the only module that turns a stored value into one of these;
     * what changed is where it gets the word.
     */
    vocabulary: {
      entry: { shore: 'Shore', boat: 'Boat', other: 'Other' } satisfies Record<Entry, string>,
      salinity: { salt: 'Salt', fresh: 'Fresh' } satisfies Record<Salinity, string>,
      waterBody: {
        ocean: 'Ocean',
        lake: 'Lake',
        river: 'River',
        quarry: 'Quarry',
        cave: 'Cave',
        pool: 'Pool',
      } satisfies Record<WaterBody, string>,
      tankMaterial: { steel: 'Steel', alu: 'Alu' } satisfies Record<TankMaterial, string>,
      configuration: {
        single: 'Single',
        twinset: 'Twinset',
        sidemount: 'Sidemount',
      } satisfies Record<Configuration, string>,
      weather: {
        sunny: 'Sunny',
        cloudy: 'Cloudy',
        overcast: 'Overcast',
        rainy: 'Rainy',
        windy: 'Windy',
        foggy: 'Foggy',
      } satisfies Record<Weather, string>,
      visibility: { high: 'High', average: 'Average', low: 'Low' } satisfies Record<Visibility, string>,
      suit: {
        none: 'None',
        shorty: 'Shorty',
        wet: 'Wet',
        semidry: 'Semidry',
        dry: 'Dry',
      } satisfies Record<Suit, string>,
      weightsFeel: { under: 'Under', good: 'Good', over: 'Over' } satisfies Record<WeightsFeel, string>,
      equipment: {
        hood: 'Hood',
        gloves: 'Gloves',
        boots: 'Boots',
        torch: 'Torch',
        camera: 'Camera',
      } satisfies Record<Equipment, string>,
      diveStatus: { logged: 'Logged', planned: 'Planned' } satisfies Record<DiveStatus, string>,
      unitSystem: { metric: 'Metric', imperial: 'Imperial' } satisfies Record<UnitSystem, string>,
      /** The three 0–3 condition scales. Three tables and not one: level 1 is a *Small* wave,
       * a *Light* current and *Some* surge (`format/display.ts`). */
      waves: { '0': 'Flat', '1': 'Small', '2': 'Medium', '3': 'Large' } satisfies Record<ConditionLevel, string>,
      current: { '0': 'None', '1': 'Light', '2': 'Medium', '3': 'Strong' } satisfies Record<ConditionLevel, string>,
      surge: { '0': 'None', '1': 'Some', '2': 'Medium', '3': 'Strong' } satisfies Record<ConditionLevel, string>,
    },

    /** The four plurals the app counts things with. All four are `format/display.ts`'s. */
    count: {
      dives_one: '{{count, figure}} dive',
      dives_other: '{{count, figure}} dives',
      sites_one: '{{count, figure}} site',
      sites_other: '{{count, figure}} sites',
      centres_one: '{{count, figure}} centre',
      centres_other: '{{count, figure}} centres',
      changesWaiting_one: '{{count, figure}} change waiting to sync',
      changesWaiting_other: '{{count, figure}} changes waiting to sync',
    },

    /** Words that stand beside a figure. The unit symbols themselves (m, ft, bar, psi, °C, min,
     * l, mm) are not here: they are the same marks in both languages, and `format/units.ts`
     * owns them. */
    figure: {
      deepest: 'deepest {{depth}}',
      /** `formatCoverage` — "7 of 24 dives". `{{total}}` already carries its own noun. */
      coverage: '{{onMap}} of {{total}}',
      today: 'Today',
      yesterday: 'Yesterday',
      daysAgo_one: '{{count, figure}} day ago',
      daysAgo_other: '{{count, figure}} days ago',
      /**
       * **The mark between a figure's whole part and its fraction**, and the one piece of this
       * file that is not a word. It is here rather than in `format/units.ts` because it is a
       * fact about a language and this is where the language's facts live — and because a
       * reviewer comparing `en` with `cs` should be able to see `.` become `,` in the same
       * place they see every other difference.
       *
       * §10's depth bands are computed from the stored metre value and never from this text,
       * so a Czech comma cannot move a dive between bands. Nothing in the app parses a
       * formatted figure back into a number; `format/units.ts`'s `displayValueFor` hands the
       * form a `number`, not a string.
       */
      decimalSeparator: '.',
    },

    /**
     * How a calendar date is written. `{{month}}` is filled from `date.month.*` below, which is
     * where the two languages differ most: English writes an abbreviated month **name**,
     * Czech a **numeral**, and the pattern supplies the punctuation each needs.
     *
     * `domain/trips.ts` reads a range's leading token back out of this string (the text before
     * its first space), so a pattern must put the day first and follow it with a space.
     */
    date: {
      long: '{{day}} {{month}} {{year}}',
      month: {
        jan: 'Jan',
        feb: 'Feb',
        mar: 'Mar',
        apr: 'Apr',
        may: 'May',
        jun: 'Jun',
        jul: 'Jul',
        aug: 'Aug',
        sep: 'Sep',
        oct: 'Oct',
        nov: 'Nov',
        dec: 'Dec',
      },
    },

    /** What a row is called when the thing behind it has no name of its own, plus what a screen
     * reader is told a map mark is. */
    place: {
      unnamedSite: 'Unnamed site',
      unnamedCenter: 'Unnamed centre',
      siteMark: '{{name}}, dive site',
      centerMark: '{{name}}, dive centre',
    },

    /** §3's certification wallet. */
    certification: {
      untitled: 'Certification',
      cardNumber: '#{{number}}',
      issued: 'issued {{date}}',
      expires: 'expires {{date}}',
      expired: 'expired {{date}}',
    },

    /** §3's RMV trend, said as a direction. Neutral on purpose: a lower figure is not "better". */
    trend: {
      steady: 'steady',
      down: 'down from {{before}}',
      up: 'up from {{before}}',
    },

    /** §3's Stats tab. Its own plural, because Czech declines the noun after "the last …". */
    stats: {
      rmvWindow_one: 'Averaged over the last {{count, figure}} dive with gas recorded.',
      rmvWindow_other: 'Averaged over the last {{count, figure}} dives with gas recorded.',
    },

    /** What the app says when it cannot read something whole (`domain/logbook.ts`,
     * `domain/presets.ts`, `screens/CertificationScreen.tsx`). */
    unreadable: {
      logbook: "Couldn't open your logbook. Try closing and reopening the app.",
      catalogue: "Couldn't read the community catalogue. Try closing and reopening the app.",
      presets: "Couldn't load your presets. Try again.",
      certifications: "Couldn't load your certifications. Try again.",
    },

    /** §3's Dives screen — the app's front door. */
    dives: {
      title: 'Dives',
      search: 'Search dives',
      logDive: 'Log a dive',
      upNext: 'Up next',
      planned: 'planned',
      diveNumber: 'Dive {{number}}',
      completeDive: 'Complete dive',
      completeDiveFor: 'Complete dive: {{site}}',
      noMatches: 'No dives match your search.',
      selectPrompt: 'Select a dive to see its details.',
      dismiss: 'Dismiss message',
      reorderFailed: "Couldn't reorder that day. Try again.",
      reorderNotApplied: "Couldn't reorder — this day already sorts by entry time.",
      settingsUnreadable:
        "Couldn't read your settings — dive numbers may be missing your pre-Ponor count.",
      syncFailed:
        'Couldn’t sync just now. Your dives are safe on this phone — try again when you’re online.',
      /** The day strip's sentence (§0.6). `{{dives}}` is `formatDiveCount`'s own phrase, which
       * stays nominative in Czech here and so composes. */
      dayStrip: '{{date}} · {{dives}}, no times',
      reorder: 'Reorder',
      reorderDay: 'Reorder {{date}}',
      done: 'Done',
      doneReordering: 'Done reordering {{date}}',
      moveUp: 'Move {{row}} up',
      moveDown: 'Move {{row}} down',
      rowPosition: 'dive {{index}} of {{total}}',
      rowPositionNamed: '{{site}} ({{position}})',
    },

    /** §0.6's first-run screen — the one place the depth scale is taught. */
    empty: {
      label: 'NOTHING LOGGED YET',
      promise:
        'Ponor keeps every dive on this phone. No account, no upload, works with the boat out of signal.',
      reasonColour: 'colour is depth',
      reasonNothingElse: 'nothing else in Ponor is coloured',
      reasonLight:
        'red fades out by {{shallow}}, blue carries past {{deep}} — the scale follows the light',
      action: 'Log your first dive',
    },

    /** §3's Settings screen. */
    settings: {
      title: 'Settings',
      saveFailed: "Couldn't save that. Try again.",
      units: 'Units',
      language: 'Language',
      /** The option that follows whatever the phone is set to. The two real languages are
       * named in themselves — a diver who lands in the wrong one has to be able to read
       * their way out — so only this one is translated. */
      languageDevice: 'Device',
      divesBefore: 'Dives before Ponor',
      divesBeforeNote: 'Dives you logged before Ponor. Your dive numbers start after it.',
      divesBeforeUnreadable: "Your saved count couldn't be read. Type it again to replace it.",
      divesBeforeInvalid: 'Whole dives only, 0 or more — nothing was saved.',
      presetsSection: 'Cylinder presets',
      noPresets: 'Save one from a dive’s Gas & cylinders group and it will show up here.',
      editPreset: 'Edit preset {{name}}',
      locationLabel: 'Location access',
      locationUnread: 'Checking…',
      locationUnreachable: 'Couldn’t open Settings from here — open it yourself and find Ponor.',
      locationRow: '{{label}}: {{status}}',
      locationGranted: 'Allowed',
      locationGrantedNote: 'Ponor can pin a dive where you are. Open Settings to change that.',
      locationDenied: 'Not allowed',
      locationDeniedNote:
        'Ponor may not use your location. iOS asks once and never again, so Settings is the only place this can change.',
      locationUndetermined: 'Not asked yet',
      locationUndeterminedNote:
        'Nobody has been asked yet — Ponor asks the first time you use it on a dive.',
      locationServicesOff: 'Location Services off',
      locationServicesOffNote:
        'Location Services are off for the whole device, so nothing on it can be located. That switch is the device’s, not Ponor’s.',
      locationUnknown: 'Unknown',
      locationUnknownNote: 'Ponor couldn’t check where this stands. Settings will show it.',
      certificationsSection: 'Certifications',
      addCertification: 'Add a certification',
      editCertification: 'Edit certification {{name}}',
      account: 'Account & sync',
      openAccount: 'Open account & sync',
    },
  },
};
