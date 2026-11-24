import type {
  Agency,
  Service,
  SiteType,
  SuitableFor,
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
import type { Provenance } from '../domain/placePicker';
import type { InlineSuggestedField } from '../domain/suggest';
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
      /** A dive site's kind, what it suits (read after *Suitable for*), and a centre's services
       * and agencies — the token sets of #31. Agency names are the agencies' own, in both languages. */
      siteTypes: {
        wreck: 'Wreck',
        reef: 'Reef',
        wall: 'Wall',
        pinnacle: 'Pinnacle',
        canyon: 'Canyon',
        swim_through: 'Swim-through',
        muck: 'Muck',
        drift: 'Drift',
        blue_water: 'Blue water',
      } satisfies Record<SiteType, string>,
      suitableFor: {
        open_water: 'Open Water',
        advanced: 'Advanced',
        experienced: 'Experienced',
        technical: 'Technical',
      } satisfies Record<SuitableFor, string>,
      services: {
        air: 'Air',
        nitrox: 'Nitrox',
        trimix: 'Trimix',
        rental: 'Rental',
        courses: 'Courses',
        boat: 'Boat dives',
        shore: 'Shore dives',
        repair: 'Repair',
      } satisfies Record<Service, string>,
      agencies: {
        padi: 'PADI',
        ssi: 'SSI',
        cmas: 'CMAS',
        naui: 'NAUI',
        sdi_tdi: 'SDI/TDI',
        raid: 'RAID',
        gue: 'GUE',
        bsac: 'BSAC',
        iantd: 'IANTD',
        other: 'Other',
      } satisfies Record<Agency, string>,
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
      /** How many readings the depth profile was drawn from (`formatSampleCount`) — the
       * caption under §0.4's chart, beside the interval the device actually used. */
      samples_one: '{{count, figure}} sample',
      samples_other: '{{count, figure}} samples',
      changesWaiting_one: '{{count, figure}} change waiting to sync',
      changesWaiting_other: '{{count, figure}} changes waiting to sync',
    },

    /** Words that stand beside a figure. The unit symbols themselves (m, ft, bar, psi, °C, min,
     * l, mm) are not here: they are the same marks in both languages, and `format/units.ts`
     * owns them. */
    figure: {
      deepest: 'deepest {{depth}}',
      lastOn: 'last {{date}}',
      /**
       * `formatCoverage` — "7 of 24 dives". `{{total}}` already carries its own noun, which is
       * the half Czech cannot copy: *z* governs the genitive, so a nominative count phrase
       * dropped in after it reads `1 z 2 lokality` where the language wants `ze 2 lokalit`.
       *
       * **So the two languages hang the noun on different numbers**, and that is why this one
       * template takes four values for two figures. English says *7 of 24 dives* — the noun on
       * the total, as it always has. Czech says *7 ponorů z 24* (`{{onMapCount}} z {{count}}`):
       * the noun rides the FIRST number, in the nominative phrase `count.dives` already owns,
       * and the preposition is left governing a bare numeral, which has no case to get wrong.
       *
       * `{{count}}` is the total, and it is here for Czech's sake alone — `z` vocalises to *ze*
       * before 2, 3 and 4, which is exactly i18next's `few`. English holds one form and no
       * suffix; i18next falls back from a missing `_one`/`_other` to the bare key, which is
       * what keeps this sentence byte-identical to the one that shipped.
       */
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
      /** The heading over the diver's own dives on a site's page and on a centre's — one
       * sentence about one relation, said on two screens about two tables. */
      yourDives: 'Your dives',
      /** A centre's two groups of facts (#31): on the create page, and on its own page. */
      contact: 'Contact',
      services: 'Services',
    },

    /** §3's certification wallet — the card's own summary line, and the editor that writes it. */
    certification: {
      untitled: 'Certification',
      cardNumber: '#{{number}}',
      issued: 'issued {{date}}',
      expires: 'expires {{date}}',
      expired: 'expired {{date}}',
      addHeading: 'Add certification',
      editHeading: 'Edit certification',
      agency: 'Agency',
      agencyPlaceholder: 'PADI',
      course: 'Course',
      coursePlaceholder: 'Rescue Diver',
      cardNumberLabel: 'Card number',
      cardNumberPlaceholder: '1234567',
      issuedLabel: 'Issued',
      expiresLabel: 'Expires',
      neverExpires: 'Doesn’t expire',
      empty: 'Add at least one detail — the agency, the course, a card number or a date.',
      save: 'Save certification',
      saveFailed: "Couldn't save that certification. Try again.",
      deleteLabel: 'Delete certification',
      deleteTitle: 'Delete this certification?',
      deleteBody: "It will be removed from your wallet. This can't be undone.",
      deleteFailed: "Couldn't delete that certification. Try again.",
      notFound: "Couldn't find that certification — it may have been deleted.",
    },

    /** §3's RMV trend, said as a direction. Neutral on purpose: a lower figure is not "better". */
    trend: {
      steady: 'steady',
      down: 'down from {{before}}',
      up: 'up from {{before}}',
    },

    /**
     * §3's Stats tab. `rmvWindow` carries its own plural, because Czech declines the noun after
     * "the last …" and a count phrase interpolated there would be nominative.
     *
     * **The counter labels are this screen's, not `field.*`'s**, and §4.1's rule for a
     * deliberate near-duplicate is to say which question each answers. `field.rmv` names *this
     * dive's* gas figure on the dive detail; `stats.rmv` names the mean over a window of recent
     * dives. They are the same three letters about two different subjects, and a shared key
     * would tie a logbook's aggregate to a dive's row.
     */
    stats: {
      title: 'Stats',
      rmvWindow_one: 'Averaged over the last {{count, figure}} dive with gas recorded.',
      rmvWindow_other: 'Averaged over the last {{count, figure}} dives with gas recorded.',
      groupLogbook: 'Logbook',
      groupPlaces: 'Places',
      groupGas: 'Gas',
      groupCurrency: 'Currency',
      dives: 'Dives',
      underwater: 'Underwater',
      deepest: 'Deepest',
      sites: 'Sites',
      countries: 'Countries',
      rmv: 'RMV',
      trend: 'Trend',
      lastDive: 'Last dive',
      nothingLogged: 'Nothing to count yet. Log a dive and this fills itself in.',
      onlyPlanned:
        'Nothing to count yet. A planned dive isn’t one you’ve done — complete it after surfacing and it lands here.',
      /**
       * **What would fill this counter, said as an instruction rather than as a diagnosis**
       * (M3n). It read "None of your dives names one that knows its country yet", which is
       * accurate and tells a diver nothing they can act on — and it fires for every diver who
       * has not signed in, which is the app's default state (§5), with dives pinned in three
       * countries on the map one tab over.
       *
       * A country belongs to a catalogue site (`countriesVisited`, domain/logbookStats.ts), and
       * a site gets one from its pin when it is published — so picking or adding a site is the
       * act, and this says so. Deriving a country from the DIVE's own pin instead would need a
       * reverse-geocode per dive (`platform/geocode.ts` is a network call), which a stats screen
       * cannot do on read and a boat cannot do at all; it is on §9's shelf.
       */
      countriesUnknown:
        'Countries come from sites in the shared catalogue. Pick or add a site on a dive and its country counts here.',
      refresher: 'Over six months since your last dive. A refresher is worth booking before the next one.',
      /** What a screen reader hears instead of the RMV bars (`RmvSparkline`). */
      rmvSeries: 'Each dive, oldest to newest: {{values}}',
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
        'Couldn’t sync just now. Your dives are safe on this phone — try again later.',
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
        'Ponor keeps every dive on this phone and works with the boat out of signal.',
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
      /** M3n: its own section. This row used to render under `presetsSection`'s heading with
       * nothing of its own, so a diver reading down met a cylinder-preset heading, a sentence
       * about cylinder presets, and then a location control that looked like part of both. */
      locationSection: 'Location',
      locationLabel: 'Location access',
      locationUnread: 'Checking…',
      locationUnreachable: 'Couldn’t open Settings from here — open it yourself and find Ponor.',
      locationRow: '{{label}}: {{status}}',
      locationGranted: 'Allowed',
      /** **"the device's Settings", never bare "Settings"** (M3n): this sentence sits on a
       * screen whose own title is Settings, so the bare word names the wrong place. `field.
       * positionDenied` already said "the device's Settings" for the same act — one of the two
       * was wrong and it was this one. */
      locationGrantedNote:
        'Ponor can pin a dive or a new place where you are, and list places near you. Open the device’s Settings to change that.',
      locationDenied: 'Not allowed',
      locationDeniedNote:
        'Ponor may not use your location. iOS asks once and never again, so Settings is the only place this can change.',
      locationUndetermined: 'Not asked yet',
      /** Since issue #19 three controls ask, not one: the dive form's GPS row, the create page's
       * *Use current position* and the picker's *Near me* — so "on a dive" was no longer the whole of it. */
      locationUndeterminedNote:
        'Nobody has been asked yet — Ponor asks the first time you pin a dive or a new place, or tap Near me.',
      locationServicesOff: 'Location Services off',
      locationServicesOffNote:
        'Location Services are off for the whole device, so nothing on it can be located. That switch is the device’s, not Ponor’s.',
      locationUnknown: 'Unknown',
      locationUnknownNote: 'Ponor couldn’t check where this stands. Settings will show it.',
      certificationsSection: 'Certifications',
      /** M3n, on `locationSection`'s reasoning: *Account & sync* was rendering under the
       * certifications heading. The section is named for what it holds rather than for the one
       * row in it today — §3 puts sync's own state here, and the destructive acts already sit
       * a section further down. */
      accountSection: 'Account',
      addCertification: 'Add a certification',
      editCertification: 'Edit certification {{name}}',
      account: 'Account & sync',
      openAccount: 'Open account & sync',
      /**
       * §3's **data export**, which §8 lists under compliance: "full data export any time —
       * CSV for spreadsheets, JSON for portability (GDPR Art. 20)".
       *
       * The two sentences under the pair are one each of the two questions a diver has here:
       * *what is in it* (the section is not called "export my dives" because it is more than
       * the dives), and *which of the two do I want*. Neither row gets its own caption — two
       * captions under two adjacent rows read as two sections.
       */
      exportSection: 'Data export',
      exportCsv: 'Export as CSV',
      exportJson: 'Export as JSON',
      exportContents:
        'Your dives, cylinder presets, certifications, and the sites and centres you added.',
      exportFiles:
        'CSV is one row per dive for a spreadsheet, in your units. JSON is everything, exactly as stored.',
      exportBusy: 'Preparing…',
      exportFailed: 'Couldn’t prepare that export, so nothing was written. Try again.',
      exportUnavailable: 'This device can’t share a file, so there’s nowhere to send it.',

      /**
       * §9's import (M3o — Task 7), in the place §3 lists it: after data export, so the section
       * name leaves room for UDDF and the rest without renaming anything.
       *
       * **The formats line is generated, not typed out** — `importFormats` is filled from
       * `importerLabels()` (`domain/import/registry.ts`), so a format added there without a
       * label cannot leave this sentence quietly out of date, the exact failure mode a literal
       * list here would invite.
       *
       * **Three failure sentences, not one.** `db/importDives.ts`'s own `ImportOutcome` gives a
       * failed *file* one of three reasons, and they are three different things for a diver, not
       * one failure with a footnote:
       *
       * - `importUnrecognised` — nothing in the registry claimed the file. A fixable mistake:
       *   the diver picked the wrong thing, and the sentence says so rather than "failed".
       * - `importFailed` — an importer claimed the file and still could not read it. Not
       *   fixable from here; the file itself is damaged, so the sentence stops at naming it
       *   rather than offering an action that would not help.
       * - `importUnwritable` — the file was read in full and its dives were fine; *saving* one
       *   to this device failed. Kept out of `importFailed` deliberately: that sentence would
       *   send a diver to re-export a file that was never the problem.
       *
       * **A fourth sentence, `importUnexpected`, is not one of those three.** It is `runImport`'s
       * own `catch` (`SettingsScreen.tsx`) — `pickImportFiles` can reject rather than resolve
       * when a chosen file's bytes fail to read (`platform/pickImportFiles.ts`'s own docblock),
       * which is a failure of the *attempt*, before any file ever reached `importFiles` to be
       * sorted into one of the three above. `exportFailed`'s own shape, one section up.
       */
      importSection: 'Data import',
      importLabel: 'Import dives',
      importFormats: 'Ponor can read: {{formats}}.',
      importing: 'Importing…',
      importDone: '{{imported}} imported, {{alreadyThere}} already in your logbook.',
      importUnrecognised: "Couldn't recognise: {{files}}. Check you picked the right files.",
      importFailed: "Couldn't read: {{files}}.",
      importUnwritable: "Couldn't save: {{files}}. Try again.",
      importUnexpected: 'Couldn’t complete the import, so nothing was written. Try again.',
      importUnavailable: 'No file picker is available on this device.',

      /**
       * §7.4's other two destructive acts (M3j), in the place §3 lists the second of them:
       * straight after data export, which is §8 pairing Art. 20 with Art. 17 in one sentence.
       *
       * **Each dialog body says what goes, what stays, and that there is no way back — in that
       * order.** `account.signOutBody`'s rule is loss first and reassurance second, "because a
       * diver who reads only the first sentence must not be reassured out of noticing it", and
       * these two have less reassurance to offer: the account survives a start over and nothing
       * survives a deletion.
       *
       * **The deletion body states §5's permanence rather than implying it** — "those sites
       * become editable by nobody through the app, including the same person signing up again".
       * It is surprising, it cannot be undone by anybody, and after the fact there is nobody
       * left to tell.
       */
      destructiveSection: 'Delete',
      destructiveNote:
        'Export your logbook first — the two rows above hand you a copy. Neither of these can be undone.',
      startOver: 'Start over',
      startOverTitle: 'Start over?',
      startOverBody:
        'Every dive, cylinder preset and certification is deleted — here, in your account, and on your other devices. Your account stays, and so do the dive sites and centres you added. This can’t be undone.',
      startOverDone: 'Your logbook is empty, here and in your account.',
      deleteAccount: 'Delete account',
      deleteAccountTitle: 'Delete your account?',
      deleteAccountBody:
        'Your account and everything in it — dives, cylinder presets, certifications — is deleted for good, on every device. The dive sites and centres you added stay in the community catalogue, and nobody can edit them again, including you if you sign up afresh. This can’t be undone.',
      /** Said afterwards, to someone who no longer has an account — §7.4's adoption sentence's
       * own shape: a statement about what already happened, with nothing to dismiss. */
      accountDeleted: 'Your account is deleted, and its logbook with it.',
      accountDeletedSites_one:
        '{{count, figure}} dive site you added stays in the community catalogue.',
      accountDeletedSites_other:
        '{{count, figure}} dive sites you added stay in the community catalogue.',
      accountDeletedCentres_one:
        '{{count, figure}} dive centre you added stays in the community catalogue.',
      accountDeletedCentres_other:
        '{{count, figure}} dive centres you added stay in the community catalogue.',
      destructiveBusy: 'Deleting…',
    },

    /** Words the whole app shares because they name one act, not one screen's version of it —
     * the two buttons on every confirmation dialog, and the announcement every row that opens
     * something makes. */
    common: {
      cancel: 'Cancel',
      delete: 'Delete',
      close: 'Close',
      open: 'Open {{name}}',
    },

    /**
     * §0.6's one treatment for leaving, as words: a visible chevroned label and the fuller thing
     * a screen reader is told — *"says what leaving does, which is the half a diver cannot see
     * from the chevron"*.
     *
     * **A way out names a destination only when the screen has exactly one way in** (M3k, the
     * owner: a site's page said *‹ Sites* and returned to the dive he came from). There were five
     * destinations here and three of them were on pages reached from several places at once — a
     * page from its directory, from a mark on the Map, and from a dive's own row — where
     * `leaveTo` (navigation/leaveScreen.ts) pops the stack and lands wherever the diver actually
     * came from. The route was always right; the word was the claim that was wrong, and it was
     * wrong on the two entrances out of three that were not the fallback.
     *
     * So the three that could not keep their promise are one pair — `any`, which names the act
     * instead, exactly as `cancel` already does for the three editors (the dive form, the preset
     * editor, the certification editor). The account screen said *‹ Settings* while Settings was
     * its only way in, and joined `any` when issue #24 gave it a second.
     */
    back: {
      any: '‹ Back',
      anyLabel: 'Go back',
      cancel: '‹ Cancel',
      cancelLabel: 'Leave without saving',
    },

    /**
     * The group header over a field's own history in its suggestion list (2026-11-14, the
     * design canvas's "YOUR BUDDIES · 2"), one per field still suggested under its own row —
     * keyed by the field's name so `formatSuggestionsTitle` reads it straight off
     * `InlineSuggestedField`. Site and centre are chosen on a page whose groups are `picker.*`.
     */
    suggest: {
      buddy: 'Your buddies',
      guide: 'Your guides',
    } satisfies Record<InlineSuggestedField, string>,

    /**
     * **§4.1's one deliberate exception, discharged.** That table has said since M1e that
     * *"roughly twenty-five field labels are duplicated as literals across the form and the dive
     * detail… they are not unified yet on purpose: translation has to key every one of them, and
     * that pass is where the set belongs"*. This is that pass, and this is where the set landed.
     *
     * Four screens read these keys — the dive form, the dive detail, the preset editor and a
     * site's page — and each of the four used to carry its own literal. A word here is what the
     * FIELD is called; what a field's *value* reads as is still `format/display.ts`'s and
     * nothing on a screen may look one up.
     *
     * The five shapes at the top are not field names: they are the sentences a screen reader
     * hears about a field, and they were retyped at eleven call sites for the same reason the
     * labels were.
     */
    field: {
      labelValue: '{{label}}: {{value}}',
      clear: 'Clear {{label}}',
      clearCarried: 'Clear carried {{label}}',
      fillWith: 'Fill {{label}} with {{value}}',
      /** `CarriedMark`'s pair (components/CarriedMark.tsx): what a row that was carried and
       * then cleared shows, and the same state without the typography for a screen reader,
       * which would otherwise spell the em dash out loud. */
      cleared: '— cleared',
      clearedSpoken: 'cleared',
      expand: 'Expand {{title}}',
      collapse: 'Collapse {{title}}',
      /** The two answers an accessory chip gives. Not a vocabulary of `domain/types.ts` — the
       * stored value is the token's presence in a set, and these are the control's own words. */
      yes: 'Yes',
      no: 'No',
      date: 'Date',
      site: 'Site',
      centre: 'Centre',
      entry: 'Entry',
      salinity: 'Salinity',
      waterBody: 'Water body',
      /** At the Salinity row's end when the water body chose it (#53): fresh for any water but the ocean. */
      fromWaterBody: 'from the water body',
      gps: 'GPS',
      country: 'Country',
      website: 'Website',
      /** Issue #31's facts about a place — the create page's rows, and the place pages'. A
       * description is public, so its row says *everyone can read it* (`newPlace`). */
      description: 'Description',
      address: 'Address',
      phone: 'Phone',
      email: 'Email',
      openingHours: 'Opening hours',
      services: 'Services',
      agencies: 'Training agencies',
      siteTypes: 'Site type',
      suitableFor: 'Suitable for',
      wreckName: 'Wreck name',
      wreckSunkYear: 'Year sunk',
      /** A site's wreck on its page, and a centre's agencies on its own — the short labels. */
      wreck: 'Wreck',
      agenciesShort: 'Agencies',
      /** One row of a site's other names, and the group that holds them. */
      altName: 'Other name',
      altNames: 'Other names',
      /** **"Site depth", never "Depth"** — §6's own parenthesis, and a site's page shows the
       * rock's depth beside the diver's deepest dive there. */
      siteDepth: 'Site depth',
      /** A site's height above sea level (#31) — not a depth, and so named apart from one. */
      altitude: 'Altitude',
      status: 'Status',
      timeIn: 'Time in',
      timeOut: 'Time out',
      surfaceInterval: 'Surface interval',
      maxDepth: 'Max depth',
      avgDepth: 'Avg depth',
      duration: 'Duration',
      cylinder: 'Cylinder',
      cylinderNumbered: 'Cylinder {{number}}',
      material: 'Material',
      size: 'Size',
      configuration: 'Configuration',
      workingPressure: 'Working pressure',
      startPressure: 'Start pressure',
      endPressure: 'End pressure',
      used: 'Used',
      mod: 'MOD',
      gasUsed: 'Gas used',
      rmv: 'RMV',
      weather: 'Weather',
      waterTemp: 'Water temp',
      airTemp: 'Air temp',
      visibility: 'Visibility',
      visibilityDistance: 'Visibility distance',
      waves: 'Waves',
      current: 'Current',
      surge: 'Surge',
      suit: 'Suit',
      suitThickness: 'Suit thickness',
      equipment: 'Equipment',
      weights: 'Weights',
      weighting: 'Weighting',
      buddy: 'Buddy',
      guide: 'Guide',
      title: 'Title',
      notes: 'Notes',
      rating: 'Rating',
      presetName: 'Preset name',
      /**
       * §7's provenance row on the dive detail — the dive computer the dive was read off, or
       * the importer's own name where the export never said which model wrote it.
       *
       * In `field.*` for the reason `group.profile` below is in `group.*`: it is a row label of
       * exactly the shape every label in this namespace has, on one of the screens where a
       * diver reads a dive back, and a second namespace for the rows a diver reads but cannot
       * type would be a distinction without a difference. What it is not is `detail.*` — that
       * holds the screen's own chrome (its way out, its two actions, its one refusal), not the
       * facts about a dive it lists.
       */
      importedFrom: 'Imported from',
    },

    /**
     * What a GROUP of dive fields is called — the dive form's collapsible groups (§2.2) and the
     * dive detail's clusters (§0.6), which are the same fields typed into and read back.
     *
     * **One namespace because two of them are one word**: *Conditions* and *Gas & cylinders* are
     * on both screens and were two literals. The rest are genuinely per-screen — a form groups
     * *Times & depth* where a detail clusters *Depth & duration* — and each is named for the
     * screen that has it rather than forced into a shared shape.
     *
     * `equipment` and `notes` here are the *group* names; `field.equipment` and `field.notes`
     * are the rows inside them (an accessory set, a free-text note). Same word, two objects.
     */
    group: {
      dateTime: 'Date & time',
      siteCentre: 'Site & centre',
      depthDuration: 'Depth & duration',
      timesDepth: 'Times & depth',
      gas: 'Gas & cylinders',
      conditions: 'Conditions',
      waterEntry: 'Water & entry',
      equipment: 'Equipment',
      equipmentPeople: 'Equipment & people',
      people: 'People',
      notes: 'Notes',
      notesRating: 'Notes & rating',
      /** §0.4's chart on the dive detail (`DepthProfile`). A cluster label like the rest of
       * this namespace, even though nothing on the form types it in: it names a block on the
       * detail exactly as *Conditions* does, and a second namespace for the one cluster the
       * diver reads but cannot enter would be a distinction without a difference. */
      profile: 'Depth profile',
    },

    /**
     * **§0.4's chart, in words** — the two labels over the scrub readout (`DepthProfile`,
     * components/DepthProfile.tsx), which name the two SERIES the plot draws.
     *
     * Not `field.*`, and the distinction is that namespace's own: a word there is what a dive
     * *field* is called, on the four screens where a diver enters one or reads it back. Neither
     * of these is a field. *Depth* here is the depth at one instant on the curve — not the
     * dive's `maxDepth` or `avgDepth`, which are different figures already named one namespace
     * over, and which is exactly the ambiguity `field.siteDepth`'s docblock refuses to allow
     * into a bare *Depth*. *Gas* is a windowed rate that has no row anywhere in the app.
     *
     * The card's TITLE is in `group.*` for the mirror-image reason: it really is a cluster
     * label like *Conditions*, and its own docblock above says so.
     *
     * **No unit words here**, on this file's standing rule: the readout formats both figures
     * through `format/display.ts`, so `m`/`ft` and `l/min`/`cu ft/min` follow the diver's own
     * setting from the one owner that already has them.
     */
    profile: {
      depth: 'Depth',
      gas: 'Gas',
    },

    /** §2.2's dive form — its own chrome, its refusals, and what its Site and Centre rows read.
     * Every field label it draws is `field.*` above, shared with the detail it will be read back
     * on. */
    form: {
      headingNewDive: 'New dive',
      headingNewPlan: 'New plan',
      headingEditDive: 'Edit dive',
      headingEditPlan: 'Edit plan',
      saveDive: 'Save dive',
      savePlan: 'Save plan',
      /**
       * M3m's discard confirmation, in the shape every other destructive dialog in this app
       * uses (`detail.deleteTitle`/`deleteBody`, `preset.*`, `certification.*`): the question
       * in the title, what is about to happen underneath.
       *
       * **Two pairs, because the true sentence is not the same one.** Leaving a new dive
       * loses a dive that has never existed anywhere; leaving an edit loses the changes and
       * the dive stays as it was. One pair covering both would have to be vague enough to be
       * true of each, and a diver deciding whether to lose work is exactly who cannot afford
       * a vague sentence.
       *
       * *Keep editing* rather than *Cancel* for the cancel slot: this dialog is itself
       * reached by pressing something called Cancel, and two Cancels in one gesture is a
       * question a diver has to re-read to answer.
       */
      discardTitle: 'Discard this dive?',
      discardBody: "What you've filled in won't be saved.",
      discardEditTitle: 'Discard your changes?',
      discardEditBody: 'This dive will stay as it was.',
      discardConfirm: 'Discard',
      discardCancel: 'Keep editing',
      /** §2.4's control names the QUESTION, and `accessibilityState` carries the answer. */
      plannedDive: 'Planned dive',
      carriedFrom: 'Carried from {{from}} — clear any of them',
      lastDive: 'your last dive',
      notSet: 'Not set',
      useMyLocation: 'Use my location',
      locating: 'Locating…',
      positionServicesOff: 'Location Services are off for this device. Turn them on to pin a dive.',
      positionDenied:
        'Ponor is not allowed to use your location. Allow it in the device’s Settings, then tap again.',
      positionTimedOut: 'That took too long. Try again where there is more sky.',
      positionImprecise:
        'That fix was only good to about {{metres, figure}} m — too rough to pin a dive site. Try again where there is more sky.',
      positionFailed: 'Could not get a location fix. Try again in a moment.',
      ratingLevel: '{{label}}: {{level}} of {{max}}',
      saveFailed: "Couldn't save this dive. Try again.",
      missingDive: "Couldn't find that dive — it may have been deleted.",
      /** The Site and Centre rows while they hold nothing — each opens the page of that name
       * (issue #19). */
      chooseSite: 'Choose a site',
      chooseCentre: 'Choose a centre',
      /** The caption under a guest's own place, which joins the community when they sign in. */
      onThisPhoneOnly: 'on this phone only',
      /** §2.3's near-match question, asked on the *New dive site* page. */
      didYouMean: 'Did you mean “{{name}}”?',
      dateInvalid: 'Enter a real date (YYYY-MM-DD).',
      unknownOption:
        'This value came from a newer version of Ponor. It is saved as it is — pick one of the options to replace it.',
      outOfScale:
        '{{value, figure}} is not one of these options. It is saved as it is — tap an option to replace it.',
    },

    /** §2.1's cylinder presets — the form's capture controls, §3's editor, and the three
     * refusals `domain/presets.ts` owns for both. */
    preset: {
      heading: 'Edit preset',
      presets: 'Presets',
      apply: 'Apply preset {{name}}',
      saveAs: 'Save as preset',
      save: 'Save preset',
      cancelSaving: 'Cancel saving a preset',
      namePlaceholder: 'twin 12 steel',
      unnamed: 'Give this preset a name, so you can find it again.',
      noCylinders: 'A preset with no cylinders fills nothing in — fill the cylinder fields first.',
      duplicate: 'You already have a preset called “{{name}}”.',
      saveFailed: "Couldn't save that preset. Try again.",
      notFound: "Couldn't find that preset — it may have been deleted.",
      deleteLabel: 'Delete preset',
      deleteTitle: 'Delete this preset?',
      deleteBody: "It will be removed from your presets. This can't be undone.",
      deleteFailed: "Couldn't delete that preset. Try again.",
    },

    /** §3's dive detail — the screen's own chrome. Its rows are `field.*` and its clusters
     * `group.*`; its *Complete dive* control says `dives.completeDive`, the same words the
     * list's own pill says. */
    detail: {
      edit: 'Edit',
      notFound: 'Dive not found.',
      deleteLabel: 'Delete dive',
      deleteTitle: 'Delete this dive?',
      deleteBody: "It will be removed from your logbook. This can't be undone.",
      deleteFailed: "Couldn't delete this dive. Try again.",
      moreActions: 'More actions',
      recordTitle: 'Dive #{{number}}',
      plannedDiveTitle: 'Planned dive',
      deleteCost: 'asks to confirm · cannot be undone',
      showOnMap: 'Show on map',
    },

    /**
     * §3's Map tab. The six switch labels say **what pressing the glyph will do**, so each kind
     * has two of them and the one on offer is the one the press carries out.
     *
     * The three "none of your N have a position" sentences each interpolate a count, and Czech
     * needs its own forms for all three — see `cs.ts`, where the genitive collapses four plural
     * categories into two.
     */
    map: {
      title: 'Map',
      showMine: 'Show your dives',
      hideMine: 'Hide your dives',
      showCommunity: 'Show community sites',
      hideCommunity: 'Hide community sites',
      showCenters: 'Show dive centres',
      hideCenters: 'Hide dive centres',
      allSites: 'All sites',
      allCentres: 'All centres',
      sitePage: 'Site page',
      /** A focused map's way to the device's maps app (issue #21) — what *Show on map* did before it
       * opened Ponor's own map, kept one tap away. The label is the iOS Maps word for the act;
       * the announcement names the place, because "Directions" alone does not say to where. */
      directions: 'Directions',
      directionsTo: 'Directions to {{name}}',
      closeSheet: 'Close {{name}}',
      noDives: 'No dives logged yet. A dive joins the map when you give it a pin.',
      /**
       * **A diver with one dive was told "None of your 1 logged dives has a pin yet"** — a real
       * wart on a screen every new diver reaches early, found while translating and left alone
       * there because that pass could not change English (owner's call to fix it, M3i).
       *
       * The singular is not the plural with a number swapped: *your only logged dive* says the
       * same thing without counting a set of one, and the instruction after it needs no count
       * at all. Czech has carried all four forms since M3g and gains nothing here.
       */
      noDivePins_one:
        'Your only logged dive has no pin yet. Open it, edit it, and tap “Use my location” at the site.',
      noDivePins_other:
        'None of your {{count, figure}} logged dives has a pin yet. Open a dive, edit it, and tap “Use my location” at the site.',
      noSitesGuest: 'No community sites here yet. They arrive with an account, on your first sync.',
      noSitesMember:
        'No community sites here yet. Sites appear as divers add them and your next sync brings them down.',
      /** The same shape as `noDivePins` above, and fixed with it (M3i). *On this phone* rather than
       * *community* since issue #19: a guest's own sites are in this layer too, and are not the
       * community's until they sign in. Two ways to give a new site a position — the dive's pin, or
       * the create page's own button — so the sentence names both. */
      noSitePositions_one:
        'The only dive site on this phone has no position yet. A new one takes the dive’s pin (“Use my location”), or tap “Use current position” as you create it.',
      noSitePositions_other:
        'None of the {{count, figure}} dive sites on this phone has a position yet. A new one takes the dive’s pin (“Use my location”), or tap “Use current position” as you create it.',
      noCentresGuest: 'No dive centres here yet. They arrive with an account, on your first sync.',
      noCentresMember:
        'No dive centres here yet. Centres appear as divers add them and your next sync brings them down.',
      /** This one DOES decline in English, because it was built from `formatCenterCount` rather
       * than from a bare number — so both forms are kept, and both are byte-identical to what
       * that composition produced. */
      noCentrePositions_one:
        'None of your {{count, figure}} centre has a position yet. Tap “All centres” to browse them.',
      noCentrePositions_other:
        'None of your {{count, figure}} centres has a position yet. Tap “All centres” to browse them.',
      nothingSelected:
        'Nothing selected. Switch on your dives, community sites or dive centres to put them on the map.',
      /** The browser build, which has no cartography (`DiveMap.web.tsx`). */
      webUnavailable: 'The map itself needs the Ponor app — the browser build has no cartography to draw on.',
      webPlaces_one: '{{count, figure}} place would be pinned here.',
      webPlaces_other: '{{count, figure}} places would be pinned here.',
    },

    /** A dive site's own page (§3, M3f) and the directory that lists them. */
    site: {
      heading: 'Dive sites',
      notFound: 'Site not found.',
      /** One name for the cluster on a site's page and the group on the create page (#31), as the
       * canvas has it. */
      facts: 'The site',
      /** A wreck's year on its row — the year as typed, never grouped. */
      sunk: 'sunk {{year}}',
      /** The note under *The site* naming what picking it fills in (the owner's pick C,
       * 2026-11-17; since #6 a row and tiles; worded for #53's rule, where the site's values replace
       * whatever the rows held, typed ones included): `rows` is their own labels — one; two joined by
       * `prefillRows`; or three, *Salinity, Water body and Entry*, the last joined by
       * `prefillRows` — and `count` how many, for the verb. */
      prefillNote_one: '{{rows}} fills in when you pick this site for a dive, over anything already there.',
      prefillNote_other: '{{rows}} fill in when you pick this site for a dive, over anything already there.',
      prefillRows: '{{first}} and {{second}}',
      searchPlaceholder: 'Search sites',
      close: 'Close sites',
      /** Both name the way a site is made since issue #19 — the dive form's *Site* row, then the
       * picker's *Create* — and only the signed-in diver's promises a sync: a guest's sites stay on
       * the phone, and a guest reads no community rows (#28). */
      noneGuest:
        'No dive sites yet. Create one from a dive: tap “Site” and type its name. It stays on this phone until you sign in.',
      noneMember:
        'No dive sites yet. On a dive, tap “Site” and type a name to find or create one; your next sync brings the community’s.',
      noMatches: 'No sites match your search.',
      /** The button on a site's page opened from a near-match on *New dive site*: picks this site
       * for the dive instead, as tapping the match once did (owner's call, PR #35). */
      useThisSite: 'Use this site',
    },

    /** A dive centre's own page (§3, M3c) and the directory that lists them. */
    centre: {
      heading: 'Dive centres',
      notFound: 'Centre not found.',
      /** What a press on a centre's address, number or email says it will do (#31). */
      showAddress: 'Show {{address}} on a map',
      call: 'Call {{phone}}',
      mail: 'Write to {{email}}',
      searchPlaceholder: 'Search centres',
      close: 'Close centres',
      noneGuest:
        'No dive centres yet. Create one from a dive: tap “Centre” and type its name. It stays on this phone until you sign in.',
      noneMember:
        'No dive centres yet. On a dive, tap “Centre” and type a name to find or create one; your next sync brings the community’s.',
      noMatches: 'No centres match your search.',
    },

    /** §3's search screen. Its "no matches" sentence is `dives.noMatches`, which the Dives list
     * already says about the same failure. */
    search: {
      close: 'Close search',
      prompt: 'Search your dives by site, centre, buddy or notes.',
    },

    /**
     * The *Choose a site* / *Choose a centre* page the dive form's two place rows open (issue
     * #19). The row meta lines are composed by `format/display.ts` (`formatPickerMeta` and its
     * siblings), which is also what reads `provenance` — the three words for where a row came
     * from, tied to `domain/placePicker.ts`'s list at compile time like every vocabulary above.
     */
    picker: {
      titleSite: 'Choose a site',
      titleCenter: 'Choose a centre',
      /** What a screen reader is told `‹ Cancel` does here — nothing is saved on this page, so
       * the form's *Leave without saving* would name the wrong loss. */
      leave: 'Leave without choosing',
      selected: 'Selected:',
      searchSites: 'Search sites',
      searchCenters: 'Search centres',
      clearSearch: 'Clear search',
      nearMe: 'Near me',
      locating: 'Locating…',
      divedHere: 'Dived here',
      divedWith: 'Dived with',
      otherSites: 'Other sites',
      otherCenters: 'Other centres',
      nearYou: 'Near you · within {{distance}}',
      nearSite: 'Near {{name}}',
      or: 'Or',
      noCenter: 'No centre',
      noCenterMeta: 'you dived without one',
      create: 'Create “{{name}}”',
      createSite: 'new site · details next',
      createCenter: 'new centre · details next',
      createSiteGuest: 'new site · kept on this phone until you sign in',
      createCenterGuest: 'new centre · kept on this phone until you sign in',
      provenance: {
        community: 'community',
        yours: 'added by you',
        phoneOnly: 'on this phone only · not shared yet',
      } satisfies Record<Provenance, string>,
      dived: 'dived',
      /** The front of a row's meta line when the query found it by another name it goes by (#31):
       * *also called Stone Gate · community · HR*. `format/display.ts`' `withAlsoCalled` places it,
       * in the picker and the Sites directory alike. */
      alsoCalled: 'also called {{name}}',
      nothingNearMatches: 'Nothing within {{distance}} matches “{{query}}”.',
      nothingNear: 'Nothing within {{distance}}.',
      /** In place of *Nothing within…* while the server is still being asked about the fix: nothing
       * on this phone is in range, and the community's rows may yet arrive. */
      lookingNear: 'Looking for places within {{distance}}…',
      /** Where rows would be on a page with none — a diver with no dives, nothing typed, *Near me*
       * off — which otherwise opened on a title, a search and a pill with nothing saying that
       * typing is the way in. `search.prompt`'s job, on this page. */
      promptSite: 'Type a name to find a site or create one.',
      promptCenter: 'Type a name to find a centre or create one.',
      /** Near me's refusals, worded for a list rather than for the form's GPS row — nothing here
       * is being pinned, so *"too rough to pin a dive site"* would be a reason that is not one.
       * `timedOut` and `failed` share a sentence: the diver's next move is the same. */
      locationDenied: 'Location is off for Ponor. Turn it on in the device’s Settings.',
      locationServicesOff: 'Location Services are off for this device.',
      locationFailed: 'Couldn’t find where you are. Try again.',
    },

    /**
     * The *New dive site / New dive centre* pages (issue #19), pushed from the picker's *Create
     * “…”* row. Only the page's own words: its rows that are fields elsewhere too — *Country*,
     * *Website*, the chips' *Salinity*, *Water body* and *Entry* — are `field.*`, the same words a
     * site's and a centre's own pages read back; a refused fix says the GPS row's `form.position*`,
     * and §2.3's question is `form.didYouMean`.
     */
    newPlace: {
      titleSite: 'New dive site',
      titleCenter: 'New dive centre',
      required: 'the name is the only thing required',
      guestNote: 'Kept on this phone. It joins the community map when you sign in.',
      name: 'Name',
      position: 'Position',
      useCurrentPosition: 'Use current position',
      /** Under *Altitude* once a fix carried a height (#31): the offer, which fills the row only when
       * tapped — a diver often logs a dive somewhere else than the site. `value` is the figure with
       * its unit, `12 m`. */
      useGpsAltitude: 'Use GPS altitude · {{value}}',
      asksThePhone: 'asks the phone where you are',
      fromTheAddress: 'from the address',
      fromThisDive: 'from this dive',
      optional: 'optional',
      saveSite: 'Save site',
      saveCenter: 'Save centre',
      saveAnyway: 'Save as a new site anyway',
      saving: 'Saving…',
      /** A failed write. The dive never received the name, so the form's *"the dive keeps the
       * name"* would be false here; what is true is that nothing on it changed. */
      saveFailed: "Couldn't save that just now. Nothing on the dive has changed.",
      /** §2.3's exact device match, which is not a question: the name typed IS a site's. */
      sameName: '“{{name}}” is already a site.',
      /** #31's third finding, not a question either: one name is a name the other place goes by —
       * the name typed is a site's other name, or an other name typed is a site's name. */
      otherName: '“{{alias}}” is another name for {{name}}.',
      /** `form.didYouMean` for a fuzzy server match that came through one of the site's other names
       * (the owner's call, 2026-11-17): *Kamena vrat* typed finds *Stone Gate* by *Kamena vrata*, and
       * the sentence says so. */
      didYouMeanAlsoCalled: 'Did you mean “{{name}}” (also called {{alias}})?',
      /** How far a near-match is from the position on the page, after its country: `HR · 120 m away`. */
      away: '{{distance}} away',
      /** Beside *Description* (#31): it is published with the place, so nobody writes a private
       * note there. */
      everyoneCanRead: 'everyone can read it',
      /** Beside *Site type*, a set: more than one may be chosen. */
      anyThatApply: 'any that apply',
      addName: '+ Add a name',
      /** What a screen reader says for it: the act, without the glyph, which VoiceOver reads as "plus"
       * (the precedent is `back.anyLabel`). */
      addNameLabel: 'Add another name',
      /** What each closed group holds, between its title and its chevron. */
      siteHint: 'water, entry, type, depth',
      altNamesHint: 'names it also goes by',
      contactHint: 'website, phone, email, hours',
      servicesHint: 'services, agencies',
    },

    /** Issue #24's offer — the card on the empty logbook and at the top of Settings while nobody
     * is signed in. Its title promises no backup: where it first appears there is nothing to back
     * up yet. */
    accountOffer: {
      title: 'Better with an account',
      optional: 'Totally optional — Ponor works fully without one.',
      action: 'Sign in or create an account',
      /** The rule between *Log your first dive* and the card. */
      or: 'or',
    },

    /** What an account adds, in one order everywhere: as words on the offer card, as sentences on
     * the account screen. Each pair says the same thing at two lengths. */
    accountPerks: {
      backupWord: 'Backups',
      devicesWord: 'Every device',
      communityWord: 'Community',
      backup: 'Your dives backed up as you log them',
      devices: 'Your logbook on your other devices',
      community: 'Share new sites and centres with other divers',
    },

    /** §5's auth screen and §7.4's sign-out. */
    account: {
      heading: 'Account',
      signInHeading: 'Sign in',
      signUpHeading: 'New account',
      signUpNote: 'We’ll email you a link to confirm the address. Open it on this phone and you’re signed in.',
      forgotPassword: 'Forgot password?',
      resetSent: 'If that address has an account, a link to choose a new password is on its way. Open it on this phone.',
      signingIn: 'Signing you in…',
      emailConfirmed: 'Your email is confirmed and you’re signed in.',
      newPasswordHeading: 'New password',
      newPassword: 'New password',
      savePassword: 'Save password',
      passwordChanged: 'Your password is changed.',
      /** Under the heading on sign-in and new account (issue #24): §7.4's adoption, said before
       * anything is typed. That the account is optional is said by the offer that leads here. */
      divesComeWithYou: 'Dives already on this phone come with you.',
      /** Under the heading once signed in — what the account does, not a claim about its state. */
      signedInSub: 'Your dives back up to this account and sync to your other devices.',
      signIn: 'Sign in',
      createAccount: 'Create account',
      switchToSignUp: 'Create an account',
      switchToSignIn: 'I already have an account',
      email: 'Email',
      password: 'Password',
      signedInAs: 'Signed in as',
      /** §7.4's adoption sentence. English moves its verb as well as its noun; Czech moves the
       * participle too, which is why it reaches all four forms. */
      adopted_one: '{{count, figure}} dive from this phone was added to your logbook.',
      adopted_other: '{{count, figure}} dives from this phone were added to your logbook.',
      signOut: 'Sign out',
      signOutTitle: 'Sign out?',
      signOutBody:
        'Your logbook will be removed from this device. It stays in your account, and signing back in brings it back.',
      checkEmail: 'Check your email',
      sentTo: 'Sent to',
      openTheLink: 'Open the link in that email on this phone and you’re signed in.',
      nothingArrives:
        'Nothing arrives? The address may be wrong, or it may already have an account — try signing in.',
      backToSignIn: 'Back to sign in',
      noBackendRefused: 'This build’s Supabase settings were refused: {{cause}}',
      noBackendMissing:
        'This build has no backend, so there is nothing to sign in to. Missing: {{missing}}.',
    },

    /** What `cloud/auth.ts` says about a sign-in, a sign-up or a sign-out — one sentence per
     * distinct refusal, and never the server's own wording. */
    auth: {
      emailRequired: 'Enter your email address.',
      passwordRequired: 'Enter your password.',
      credentialsRejected: 'That email and password don’t match an account.',
      emailTaken: 'That email already has an account — sign in instead.',
      passwordTooWeak: 'That password is too weak — try a longer one.',
      emailMalformed: 'That doesn’t look like an email address.',
      signupDisabled: 'New accounts are switched off right now.',
      tooManyTries: 'Too many tries. Wait a minute and try again.',
      confirmationRequired:
        'This account isn’t confirmed yet. Open the link in the email sent to that address, then sign in.',
      serverUnreachable:
        'Couldn’t reach the server — no connection here, or the server is down. Your logbook is safe on this phone; try again later.',
      signInFailed: 'Couldn’t sign in. Try again.',
      signUpFailed: 'Couldn’t create the account. Try again.',
      resetFailed: 'Couldn’t send the reset email. Try again.',
      linkExpired: 'That link has expired. Ask for a new one.',
      linkFailed: 'That link can’t be used on this phone. Sign in with your email and password instead.',
      samePassword: 'That’s your current password. Choose a different one.',
      passwordChangeFailed: 'Couldn’t save the new password. Try again.',
      signOutUnavailable: 'Sign-out can’t clear this device yet, so nothing was signed out.',
      wipeFailed: 'Couldn’t clear this device’s logbook, so nothing was signed out.',
      unpushedChanges:
        'This phone has dives your account hasn’t received yet. Nothing was cleared, and you’re still signed in — try again later.',
      signOutFailed: 'This device’s logbook was cleared, but signing out didn’t finish. Try again.',
      /* §7.4's other two destructive acts (M3j). Each names a state sign-out cannot be in —
       * see the functions in `cloud/auth.ts` for why none of them reuses a sentence above. */
      startOverUnavailable: 'This build can’t clear the device, so nothing was deleted.',
      startOverUnpushed:
        'Deleted on this device. Your account hasn’t received the deletion yet — it goes up once a sync gets through.',
      startOverFailed:
        'Your account is empty, but this device’s logbook couldn’t be cleared. Try again.',
      deleteAccountUnavailable:
        'This build can’t clear the device, so your account wasn’t deleted either.',
      deleteAccountFailed:
        'Couldn’t reach your account, so nothing was deleted. Try again later.',
      accountDeletedDeviceKept:
        'Your account is deleted, but this device’s logbook couldn’t be cleared. Deleting the app removes it.',
    },
  },
};
