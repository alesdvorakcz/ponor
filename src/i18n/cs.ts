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
 * **Czech.** `en.ts` is the app; this is the translation of it, and `i18n/index.test.ts`
 * requires the two to hold the same keys — plural suffixes normalised away, because the whole
 * point is that they differ there.
 *
 * **Four plural forms, not two** (§0.5). `one` is 1, `few` is 2–4, `many` is a fraction (1,5
 * ponoru), `other` is 0 and 5 upwards. Czech's `many` is unreachable from the app's own callers
 * — everything counted here is an array's length — but it is written because the rule has four
 * branches and a resource missing one is a resource that falls back to English the day
 * something fractional reaches it.
 *
 * **Case government is why some sentences carry their own count.** *"5 ponorů"* is nominative;
 * *"z posledních 5 ponorů"* needs the genitive the preposition asks for. English never notices,
 * which is exactly why a sentence built by interpolating an English count phrase reads wrong in
 * Czech and passes every test. `stats.rmvWindow` therefore declines the noun itself instead of
 * taking `count.dives`'s phrase; `dives.dayStrip` composes, because a count phrase standing
 * after a middot is nominative and stays it.
 *
 * **Numbers and dates are not words and are handled where words are not.** `figure.
 * decimalSeparator` is a comma here (41,2 m). `date.long` writes the day and month as numerals
 * with full stops — `16. 8. 2026` — because a Czech month name would have to be genitive
 * (*16. srpna*), which is correct and longer, and this app writes dates in dense rows. The
 * choice is the owner's to overturn; both spellings live entirely in this file.
 *
 * **The app's own name declines** (§0), which is what makes *"Ponory před Ponorem"* grammatical
 * rather than a mistake. It is still a strange sentence in an app called Ponor, and it is
 * strange in English too.
 */
export const cs = {
  translation: {
    tabs: {
      dives: 'Ponory',
      map: 'Mapa',
      stats: 'Statistiky',
      settings: 'Nastavení',
    },

    vocabulary: {
      entry: { shore: 'Břeh', boat: 'Loď', other: 'Jiný' } satisfies Record<Entry, string>,
      /** The water, so the adjectives are feminine: *slaná voda*, *sladká voda*. */
      salinity: { salt: 'Slaná', fresh: 'Sladká' } satisfies Record<Salinity, string>,
      waterBody: {
        ocean: 'Oceán',
        lake: 'Jezero',
        river: 'Řeka',
        quarry: 'Lom',
        cave: 'Jeskyně',
        pool: 'Bazén',
      } satisfies Record<WaterBody, string>,
      tankMaterial: { steel: 'Ocel', alu: 'Hliník' } satisfies Record<TankMaterial, string>,
      /** *Dvojče* and *sidemount* are what Czech divers say; *jedna láhev* is the plain
       * description, since there is no single word for a single. */
      configuration: {
        single: 'Jedna láhev',
        twinset: 'Dvojče',
        sidemount: 'Sidemount',
      } satisfies Record<Configuration, string>,
      /** Adverbs throughout, which is how Czech states weather — *slunečno*, not *slunce*. */
      weather: {
        sunny: 'Slunečno',
        cloudy: 'Oblačno',
        overcast: 'Zataženo',
        rainy: 'Deštivo',
        windy: 'Větrno',
        foggy: 'Mlhavo',
      } satisfies Record<Weather, string>,
      visibility: { high: 'Vysoká', average: 'Průměrná', low: 'Nízká' } satisfies Record<Visibility, string>,
      suit: {
        none: 'Žádný',
        shorty: 'Shorty',
        wet: 'Mokrý',
        semidry: 'Polosuchý',
        dry: 'Suchý',
      } satisfies Record<Suit, string>,
      weightsFeel: { under: 'Málo', good: 'Akorát', over: 'Hodně' } satisfies Record<WeightsFeel, string>,
      equipment: {
        hood: 'Kukla',
        gloves: 'Rukavice',
        boots: 'Boty',
        torch: 'Svítilna',
        camera: 'Fotoaparát',
      } satisfies Record<Equipment, string>,
      diveStatus: { logged: 'Zaznamenaný', planned: 'Plánovaný' } satisfies Record<DiveStatus, string>,
      unitSystem: { metric: 'Metrické', imperial: 'Imperiální' } satisfies Record<UnitSystem, string>,
      /** *Vlny* are feminine plural, *proud* masculine, *vlnobití* neuter — which is why the
       * three tables cannot share one set of adjectives even where English repeats a word. */
      waves: { '0': 'Klid', '1': 'Malé', '2': 'Střední', '3': 'Velké' } satisfies Record<ConditionLevel, string>,
      current: { '0': 'Žádný', '1': 'Slabý', '2': 'Střední', '3': 'Silný' } satisfies Record<ConditionLevel, string>,
      surge: { '0': 'Žádné', '1': 'Mírné', '2': 'Střední', '3': 'Silné' } satisfies Record<ConditionLevel, string>,
    },

    count: {
      dives_one: '{{count, figure}} ponor',
      dives_few: '{{count, figure}} ponory',
      dives_many: '{{count, figure}} ponoru',
      dives_other: '{{count, figure}} ponorů',
      sites_one: '{{count, figure}} lokalita',
      sites_few: '{{count, figure}} lokality',
      sites_many: '{{count, figure}} lokality',
      sites_other: '{{count, figure}} lokalit',
      centres_one: '{{count, figure}} centrum',
      centres_few: '{{count, figure}} centra',
      centres_many: '{{count, figure}} centra',
      centres_other: '{{count, figure}} center',
      changesWaiting_one: '{{count, figure}} změna čeká na synchronizaci',
      changesWaiting_few: '{{count, figure}} změny čekají na synchronizaci',
      changesWaiting_many: '{{count, figure}} změny čeká na synchronizaci',
      changesWaiting_other: '{{count, figure}} změn čeká na synchronizaci',
    },

    figure: {
      deepest: 'nejhlubší {{depth}}',
      /**
       * **The noun rides the FIRST number here, where English hangs it on the second.**
       * *7 ponorů z 24*, not *7 z 24 ponorů* — because `z` governs the genitive and
       * `count.dives`' phrase is nominative, so the composed version read `1 z 2 lokality`
       * where Czech wants `ze 2 lokalit`. Moving the noun in front of the preposition leaves
       * `z` governing a bare numeral, which has no case to get wrong.
       *
       * **The four forms differ by one letter and it is not a plural.** `z` vocalises to `ze`
       * before a word beginning with an awkward cluster, and *dvou*, *tří* and *čtyř* are three
       * of them — which is exactly i18next's `few`. It is a phonological rule wearing a plural
       * category's clothes, and it is right for 2–4 and 1 and 5 and most of what follows. It is
       * **wrong** for 6, 7, 16, 17, 60–79 and 100–400, whose numerals also begin with those
       * sounds and which no plural category can pick out; those read `z` and would be spoken
       * `ze`. Fixing them needs a rule about how a numeral is PRONOUNCED, which is a second
       * owner of a language rule written in JavaScript. Reported rather than attempted.
       */
      coverage_one: '{{onMapCount}} z {{count, figure}}',
      coverage_few: '{{onMapCount}} ze {{count, figure}}',
      coverage_many: '{{onMapCount}} z {{count, figure}}',
      coverage_other: '{{onMapCount}} z {{count, figure}}',
      today: 'Dnes',
      yesterday: 'Včera',
      daysAgo_one: 'před {{count, figure}} dnem',
      daysAgo_few: 'před {{count, figure}} dny',
      daysAgo_many: 'před {{count, figure}} dne',
      daysAgo_other: 'před {{count, figure}} dny',
      decimalSeparator: ',',
    },

    /** `16. 8. 2026`. The month is a numeral, so `date.month.*` holds `'1'`…`'12'` and the
     * pattern supplies both full stops — see this file's own docblock for why not *srpna*. */
    date: {
      long: '{{day}}. {{month}}. {{year}}',
      month: {
        jan: '1',
        feb: '2',
        mar: '3',
        apr: '4',
        may: '5',
        jun: '6',
        jul: '7',
        aug: '8',
        sep: '9',
        oct: '10',
        nov: '11',
        dec: '12',
      },
    },

    place: {
      unnamedSite: 'Nepojmenovaná lokalita',
      unnamedCenter: 'Nepojmenované centrum',
      siteMark: '{{name}}, potápěčská lokalita',
      centerMark: '{{name}}, potápěčské centrum',
      yourDives: 'Vaše ponory',
    },

    certification: {
      untitled: 'Certifikace',
      cardNumber: 'č. {{number}}',
      issued: 'vydáno {{date}}',
      /** *Platí do* / *platnost skončila* rather than a verb agreeing with the card, so the
       * line reads the same whichever noun a diver has in mind. */
      expires: 'platí do {{date}}',
      expired: 'platnost skončila {{date}}',
      addHeading: 'Přidat certifikaci',
      editHeading: 'Upravit certifikaci',
      /** *Organizace*, not *agentura*: PADI and SSI call themselves agencies in English and
       * Czech divers say *organizace*. */
      agency: 'Organizace',
      agencyPlaceholder: 'PADI',
      course: 'Kurz',
      coursePlaceholder: 'Rescue Diver',
      cardNumberLabel: 'Číslo karty',
      cardNumberPlaceholder: '1234567',
      issuedLabel: 'Vydáno',
      expiresLabel: 'Platí do',
      neverExpires: 'Nevyprší',
      empty: 'Vyplňte aspoň jeden údaj — organizaci, kurz, číslo karty nebo datum.',
      save: 'Uložit certifikaci',
      saveFailed: 'Certifikaci se nepodařilo uložit. Zkuste to znovu.',
      deleteLabel: 'Smazat certifikaci',
      deleteTitle: 'Smazat tuto certifikaci?',
      deleteBody: 'Zmizí z vaší peněženky. Tohle nejde vzít zpět.',
      deleteFailed: 'Certifikaci se nepodařilo smazat. Zkuste to znovu.',
      notFound: 'Tu certifikaci se nepodařilo najít — možná byla smazána.',
    },

    /** *Spotřeba* is feminine, hence *klesla* / *stoupla*. Neutral verbs: the figure moved,
     * and the app does not grade a diver's breathing. */
    trend: {
      steady: 'beze změny',
      down: 'klesla z {{before}}',
      up: 'stoupla z {{before}}',
    },

    stats: {
      title: 'Statistiky',
      rmvWindow_one: 'Průměr z posledního {{count, figure}} ponoru se zaznamenaným plynem.',
      rmvWindow_few: 'Průměr z posledních {{count, figure}} ponorů se zaznamenaným plynem.',
      rmvWindow_many: 'Průměr z posledních {{count, figure}} ponoru se zaznamenaným plynem.',
      rmvWindow_other: 'Průměr z posledních {{count, figure}} ponorů se zaznamenaným plynem.',
      groupLogbook: 'Deník',
      groupPlaces: 'Místa',
      groupGas: 'Plyn',
      /** *Aktuálnost* — how current a diver's practice is, which is what §3's "currency" means
       * and what a Czech instructor calls it. Not *měna*. */
      groupCurrency: 'Aktuálnost',
      dives: 'Ponory',
      underwater: 'Pod vodou',
      deepest: 'Nejhlubší',
      sites: 'Lokality',
      countries: 'Země',
      rmv: 'RMV',
      trend: 'Trend',
      lastDive: 'Poslední ponor',
      nothingLogged: 'Zatím není co počítat. Zaznamenejte ponor a tohle se vyplní samo.',
      onlyPlanned:
        'Zatím není co počítat. Plánovaný ponor není ponor, který jste odpotápěli — dokončete ho po vynoření a objeví se tady.',
      countriesUnknown:
        'Země pocházejí z lokalit na mapě. Žádný z vašich ponorů zatím nejmenuje lokalitu, která zná svoji zemi.',
      refresher: 'Od posledního ponoru uplynulo přes půl roku. Před dalším se vyplatí objednat opakovací kurz.',
      rmvSeries: 'Každý ponor, od nejstaršího po nejnovější: {{values}}',
    },

    unreadable: {
      logbook: 'Deník se nepodařilo otevřít. Zkuste aplikaci zavřít a znovu otevřít.',
      catalogue: 'Komunitní katalog se nepodařilo načíst. Zkuste aplikaci zavřít a znovu otevřít.',
      presets: 'Předvolby se nepodařilo načíst. Zkuste to znovu.',
      certifications: 'Certifikace se nepodařilo načíst. Zkuste to znovu.',
    },

    dives: {
      title: 'Ponory',
      search: 'Hledat ponory',
      logDive: 'Zaznamenat ponor',
      /** §10 already wrote this one, in the entry about why a rule must never key on a display
       * string: *"the day it becomes `Další v pořadí`"*. */
      upNext: 'Další v pořadí',
      planned: 'plánovaný',
      diveNumber: 'Ponor {{number}}',
      completeDive: 'Dokončit ponor',
      completeDiveFor: 'Dokončit ponor: {{site}}',
      noMatches: 'Hledání neodpovídá žádný ponor.',
      selectPrompt: 'Vyberte ponor a uvidíte podrobnosti.',
      dismiss: 'Zavřít zprávu',
      reorderFailed: 'Ten den se nepodařilo seřadit. Zkuste to znovu.',
      reorderNotApplied: 'Nelze seřadit — tento den se už řadí podle času vstupu.',
      settingsUnreadable:
        'Nastavení se nepodařilo přečíst — v číslech ponorů může chybět počet před Ponorem.',
      syncFailed:
        'Synchronizace se teď nezdařila. Vaše ponory jsou v bezpečí v telefonu — zkuste to znovu, až budete online.',
      dayStrip: '{{date}} · {{dives}}, bez časů',
      reorder: 'Seřadit',
      reorderDay: 'Seřadit {{date}}',
      done: 'Hotovo',
      doneReordering: 'Dokončit řazení {{date}}',
      moveUp: 'Posunout {{row}} nahoru',
      moveDown: 'Posunout {{row}} dolů',
      rowPosition: 'ponor {{index}} z {{total}}',
      rowPositionNamed: '{{site}} ({{position}})',
    },

    empty: {
      label: 'ZATÍM NIC ZAZNAMENÁNO',
      promise:
        'Ponor drží každý ponor v tomto telefonu. Žádný účet, žádné nahrávání, funguje i s lodí mimo signál.',
      reasonColour: 'barva je hloubka',
      reasonNothingElse: 'nic jiného v Ponoru barvu nemá',
      reasonLight:
        'červená mizí v {{shallow}}, modrá drží i za {{deep}} — škála sleduje světlo',
      action: 'Zaznamenat první ponor',
    },

    settings: {
      title: 'Nastavení',
      saveFailed: 'Nepodařilo se to uložit. Zkuste to znovu.',
      units: 'Jednotky',
      language: 'Jazyk',
      languageDevice: 'Zařízení',
      divesBefore: 'Ponory před Ponorem',
      divesBeforeNote: 'Ponory, které jste zaznamenali před Ponorem. Čísla ponorů začínají za nimi.',
      divesBeforeUnreadable: 'Uložený počet se nepodařilo přečíst. Napište ho znovu.',
      divesBeforeInvalid: 'Jen celé ponory, 0 a více — nic se neuložilo.',
      presetsSection: 'Předvolby lahví',
      noPresets: 'Uložte si ji u ponoru ve skupině Plyn a láhve a objeví se tady.',
      editPreset: 'Upravit předvolbu {{name}}',
      locationLabel: 'Přístup k poloze',
      locationUnread: 'Zjišťuji…',
      locationUnreachable: 'Nastavení se odsud nepodařilo otevřít — otevřete je sami a najděte Ponor.',
      locationRow: '{{label}}: {{status}}',
      locationGranted: 'Povoleno',
      locationGrantedNote: 'Ponor může připnout ponor tam, kde jste. V Nastavení to jde změnit.',
      locationDenied: 'Nepovoleno',
      locationDeniedNote:
        'Ponor nesmí používat vaši polohu. iOS se zeptá jednou a nikdy víc, takže Nastavení je jediné místo, kde to jde změnit.',
      locationUndetermined: 'Zatím nedotázáno',
      locationUndeterminedNote:
        'Nikdo se zatím neptal — Ponor se zeptá, až to poprvé použijete u ponoru.',
      locationServicesOff: 'Polohové služby vypnuté',
      locationServicesOffNote:
        'Polohové služby jsou vypnuté pro celé zařízení, takže na něm nelze nic lokalizovat. Ten přepínač patří zařízení, ne Ponoru.',
      locationUnknown: 'Neznámo',
      locationUnknownNote: 'Ponor nedokázal zjistit, jak na tom jste. Nastavení to ukáže.',
      certificationsSection: 'Certifikace',
      addCertification: 'Přidat certifikaci',
      editCertification: 'Upravit certifikaci {{name}}',
      account: 'Účet a synchronizace',
      openAccount: 'Otevřít účet a synchronizaci',
      exportSection: 'Export dat',
      exportCsv: 'Exportovat jako CSV',
      exportJson: 'Exportovat jako JSON',
      exportContents:
        'Vaše ponory, předvolby lahví, certifikace a lokality a centra, která jste přidali.',
      exportFiles:
        'CSV má jeden řádek na ponor, ve vašich jednotkách, pro tabulkový editor. JSON obsahuje všechno přesně tak, jak je to uložené.',
      exportBusy: 'Připravuji…',
      exportFailed: 'Export se nepodařilo připravit, takže se nic nezapsalo. Zkuste to znovu.',
      exportUnavailable: 'Toto zařízení neumí sdílet soubor, takže není kam ho poslat.',

      destructiveSection: 'Mazání',
      destructiveNote:
        'Nejdřív si deník vyexportujte — dva řádky nad tímto vám ho vydají. Ani jedno z toho nejde vzít zpět.',
      startOver: 'Začít znovu',
      startOverTitle: 'Začít znovu?',
      startOverBody:
        'Každý ponor, předvolba lahví i certifikace se smažou — tady, ve vašem účtu i ve vašich dalších zařízeních. Účet vám zůstane a zůstanou i lokality a centra, která jste přidali. Nejde to vzít zpět.',
      startOverDone: 'Váš deník je prázdný — tady i ve vašem účtu.',
      deleteAccount: 'Smazat účet',
      deleteAccountTitle: 'Smazat váš účet?',
      deleteAccountBody:
        'Váš účet a všechno v něm — ponory, předvolby lahví, certifikace — se nenávratně smaže, ve všech zařízeních. Lokality a centra, která jste přidali, zůstanou v komunitním katalogu a nikdo je už nebude moct upravit, ani vy, pokud si založíte účet znovu. Nejde to vzít zpět.',
      accountDeleted: 'Váš účet je smazaný a s ním i jeho deník.',
      /** All four forms. *Lokalita* is feminine, so the verb and the relative pronoun move
       * with the count as well as the noun — `account.adopted`'s own rule. */
      accountDeletedSites_one:
        'V komunitním katalogu zůstává {{count, figure}} lokalita, kterou jste přidali.',
      accountDeletedSites_few:
        'V komunitním katalogu zůstávají {{count, figure}} lokality, které jste přidali.',
      accountDeletedSites_many:
        'V komunitním katalogu zůstává {{count, figure}} lokality, které jste přidali.',
      accountDeletedSites_other:
        'V komunitním katalogu zůstává {{count, figure}} lokalit, které jste přidali.',
      /** *Centrum* is neuter, and declines differently again. */
      accountDeletedCentres_one:
        'V komunitním katalogu zůstává {{count, figure}} centrum, které jste přidali.',
      accountDeletedCentres_few:
        'V komunitním katalogu zůstávají {{count, figure}} centra, která jste přidali.',
      accountDeletedCentres_many:
        'V komunitním katalogu zůstává {{count, figure}} centra, která jste přidali.',
      accountDeletedCentres_other:
        'V komunitním katalogu zůstává {{count, figure}} center, která jste přidali.',
      destructiveBusy: 'Mažu…',
    },

    common: {
      cancel: 'Zrušit',
      delete: 'Smazat',
      close: 'Zavřít',
      open: 'Otevřít {{name}}',
    },

    back: {
      dives: '‹ Ponory',
      divesLabel: 'Zpět na ponory',
      sites: '‹ Lokality',
      sitesLabel: 'Zpět na lokality',
      centres: '‹ Centra',
      centresLabel: 'Zpět na centra',
      settings: '‹ Nastavení',
      settingsLabel: 'Zpět do Nastavení',
      cancel: '‹ Zrušit',
      cancelLabel: 'Odejít bez uložení',
    },

    /**
     * **A field name interpolated into a sentence stays in the nominative**, and that is a
     * deliberate compromise rather than an oversight. *Vymazat Max. hloubka* wants the
     * accusative *Max. hloubku*, and getting it would need a second, cased form of every one of
     * these forty labels — a table Czech would have to keep in step with the nominative one for
     * the sake of five screen-reader strings. Czech interfaces do exactly this, and a screen
     * reader announcing the label unchanged is what lets a diver match what they heard to the
     * row they are on.
     */
    field: {
      labelValue: '{{label}}: {{value}}',
      clear: 'Vymazat {{label}}',
      clearCarried: 'Vymazat převzaté {{label}}',
      fillWith: 'Vyplnit {{label}} hodnotou {{value}}',
      cleared: '— vymazáno',
      clearedSpoken: 'vymazáno',
      expand: 'Rozbalit {{title}}',
      collapse: 'Sbalit {{title}}',
      yes: 'Ano',
      no: 'Ne',
      date: 'Datum',
      site: 'Lokalita',
      centre: 'Centrum',
      entry: 'Vstup',
      salinity: 'Slanost',
      waterBody: 'Vodní plocha',
      gps: 'GPS',
      country: 'Země',
      website: 'Web',
      siteDepth: 'Hloubka lokality',
      status: 'Stav',
      /** *Čas vstupu* / *Čas výstupu*, agreeing with `field.entry` above — the water is what a
       * diver goes into and comes out of, and *Začátek* / *Konec* would name the clock instead. */
      timeIn: 'Čas vstupu',
      timeOut: 'Čas výstupu',
      surfaceInterval: 'Povrchový interval',
      maxDepth: 'Max. hloubka',
      avgDepth: 'Prům. hloubka',
      duration: 'Doba ponoru',
      cylinder: 'Láhev',
      cylinderNumbered: 'Láhev {{number}}',
      material: 'Materiál',
      /** A cylinder's water capacity in litres, which Czech divers call its *objem*. */
      size: 'Objem',
      configuration: 'Konfigurace',
      workingPressure: 'Provozní tlak',
      startPressure: 'Počáteční tlak',
      endPressure: 'Konečný tlak',
      /** *Spotřeba* is the bar used; *Spotřeba plynu* the litres. Same noun, two quantities,
       * exactly as English's *Used* and *Gas used* are. */
      used: 'Spotřeba',
      mod: 'MOD',
      gasUsed: 'Spotřeba plynu',
      rmv: 'RMV',
      weather: 'Počasí',
      waterTemp: 'Teplota vody',
      airTemp: 'Teplota vzduchu',
      /** The judged scale is *viditelnost*; the measured distance is *dohlednost*, which is the
       * meteorological term for exactly that and the only word that still means the right thing
       * when the row is read on its own. */
      visibility: 'Viditelnost',
      visibilityDistance: 'Dohlednost',
      waves: 'Vlny',
      current: 'Proud',
      surge: 'Vlnobití',
      suit: 'Oblek',
      suitThickness: 'Tloušťka obleku',
      equipment: 'Vybavení',
      /** The lead itself is *zátěž*; how it felt is *vyvážení*, which is what a diver says about
       * being over- or under-weighted. */
      weights: 'Zátěž',
      weighting: 'Vyvážení',
      buddy: 'Buddy',
      guide: 'Průvodce',
      title: 'Název',
      notes: 'Poznámky',
      rating: 'Hodnocení',
      presetName: 'Název předvolby',
    },

    group: {
      dateTime: 'Datum a čas',
      siteCentre: 'Lokalita a centrum',
      depthDuration: 'Hloubka a doba',
      timesDepth: 'Časy a hloubka',
      /** Named in `settings.noPresets` too — *"ve skupině Plyn a láhve"* — so the sentence
       * pointing at this group and the group's own heading are one string. */
      gas: 'Plyn a láhve',
      conditions: 'Podmínky',
      waterEntry: 'Voda a vstup',
      equipment: 'Vybavení',
      equipmentPeople: 'Vybavení a lidé',
      people: 'Lidé',
      notes: 'Poznámky',
      notesRating: 'Poznámky a hodnocení',
    },

    form: {
      headingNewDive: 'Nový ponor',
      headingNewPlan: 'Nový plán',
      headingEditDive: 'Upravit ponor',
      headingEditPlan: 'Upravit plán',
      saveDive: 'Uložit ponor',
      savePlan: 'Uložit plán',
      plannedDive: 'Plánovaný ponor',
      /** `{{from}}` is either `#6` or `form.lastDive` below, and both stand in the genitive
       * after *z* — which is why the fallback is written *posledního ponoru* rather than as a
       * nominative phrase this sentence would then govern wrongly. */
      carriedFrom: 'Převzato z {{from}} — cokoli z toho můžete vymazat',
      lastDive: 'posledního ponoru',
      notSet: 'Nevyplněno',
      useMyLocation: 'Použít moji polohu',
      locating: 'Zjišťuji polohu…',
      positionServicesOff:
        'Polohové služby jsou pro toto zařízení vypnuté. Zapněte je, abyste mohli ponor připnout.',
      positionDenied:
        'Ponor nesmí používat vaši polohu. Povolte ji v Nastavení zařízení a klepněte znovu.',
      positionTimedOut: 'Trvalo to příliš dlouho. Zkuste to znovu tam, kde je víc oblohy.',
      positionImprecise:
        'Poloha vyšla přesná jen asi na {{metres, figure}} m — na připnutí lokality je to příliš hrubé. Zkuste to znovu tam, kde je víc oblohy.',
      positionFailed: 'Polohu se nepodařilo zjistit. Zkuste to za chvíli znovu.',
      ratingLevel: '{{label}}: {{level}} z {{max}}',
      saveFailed: 'Tento ponor se nepodařilo uložit. Zkuste to znovu.',
      missingDive: 'Ten ponor se nepodařilo najít — možná byl smazán.',
      addSite: 'Přidat „{{name}}“ jako novou lokalitu',
      addCentre: 'Přidat „{{name}}“ jako nové potápěčské centrum',
      addingSite: 'Přidávám lokalitu…',
      addingCentre: 'Přidávám centrum…',
      addFailed: 'Teď se to nepodařilo přidat — ponor si název ponechá.',
      /** *i tak* goes at the END in Czech, where English's *anyway* also does — so the offer
       * can still be interpolated whole rather than written out a second time per table. */
      addAnyway: '{{offer}} i tak',
      didYouMean: 'Nemysleli jste „{{name}}“?',
      lookingForMatch: 'Hledám shodu…',
      dateInvalid: 'Zadejte skutečné datum (RRRR-MM-DD).',
      unknownOption:
        'Tato hodnota pochází z novější verze Ponoru. Ukládá se tak, jak je — nahradíte ji výběrem některé z možností.',
      outOfScale:
        '{{value, figure}} není žádná z těchto možností. Ukládá se tak, jak je — nahradíte ji klepnutím na některou.',
    },

    preset: {
      heading: 'Upravit předvolbu',
      presets: 'Předvolby',
      apply: 'Použít předvolbu {{name}}',
      saveAs: 'Uložit jako předvolbu',
      save: 'Uložit předvolbu',
      cancelSaving: 'Zrušit ukládání předvolby',
      namePlaceholder: 'dvojče 12 ocel',
      unnamed: 'Pojmenujte tuto předvolbu, ať ji zase najdete.',
      noCylinders: 'Předvolba bez lahví nic nevyplní — vyplňte nejdřív pole láhve.',
      duplicate: 'Předvolbu s názvem „{{name}}“ už máte.',
      saveFailed: 'Předvolbu se nepodařilo uložit. Zkuste to znovu.',
      notFound: 'Tu předvolbu se nepodařilo najít — možná byla smazána.',
      deleteLabel: 'Smazat předvolbu',
      deleteTitle: 'Smazat tuto předvolbu?',
      deleteBody: 'Zmizí z vašich předvoleb. Tohle nejde vzít zpět.',
      deleteFailed: 'Předvolbu se nepodařilo smazat. Zkuste to znovu.',
    },

    detail: {
      edit: 'Upravit',
      notFound: 'Ponor nenalezen.',
      deleteLabel: 'Smazat ponor',
      deleteTitle: 'Smazat tento ponor?',
      deleteBody: 'Zmizí z vašeho deníku. Tohle nejde vzít zpět.',
      deleteFailed: 'Tento ponor se nepodařilo smazat. Zkuste to znovu.',
    },

    /**
     * **The three "none of your N …" sentences reach only two Czech forms, not four.** After
     * *z vašich* the noun is genitive plural for 2–4 and for 5-and-up alike — *z vašich 3
     * ponorů*, *z vašich 30 ponorů* — so `few`, `many` and `other` are one sentence. Only `one`
     * differs, and it drops the numeral for *jediný*: *z vašich 1 ponorů* is not Czech, and
     * "your only logged dive" says the same thing better than "your 1 logged dive" does in
     * English.
     *
     * Putting *vašich* between the preposition and the numeral also settles the vocalisation
     * `figure.coverage` above cannot: *z* stands before a word here, never before a digit.
     */
    map: {
      title: 'Mapa',
      showMine: 'Zobrazit vaše ponory',
      hideMine: 'Skrýt vaše ponory',
      showCommunity: 'Zobrazit komunitní lokality',
      hideCommunity: 'Skrýt komunitní lokality',
      showCenters: 'Zobrazit potápěčská centra',
      hideCenters: 'Skrýt potápěčská centra',
      allSites: 'Všechny lokality',
      allCentres: 'Všechna centra',
      sitePage: 'Stránka lokality',
      closeSheet: 'Zavřít {{name}}',
      noDives: 'Zatím žádný zaznamenaný ponor. Ponor se na mapě objeví, jakmile mu dáte bod.',
      noDivePins_one:
        'Váš jediný zaznamenaný ponor zatím nemá bod. Otevřete ponor, upravte ho a u lokality klepněte na „Použít moji polohu“.',
      noDivePins_few:
        'Žádný z vašich {{count, figure}} zaznamenaných ponorů zatím nemá bod. Otevřete ponor, upravte ho a u lokality klepněte na „Použít moji polohu“.',
      noDivePins_many:
        'Žádný z vašich {{count, figure}} zaznamenaných ponorů zatím nemá bod. Otevřete ponor, upravte ho a u lokality klepněte na „Použít moji polohu“.',
      noDivePins_other:
        'Žádný z vašich {{count, figure}} zaznamenaných ponorů zatím nemá bod. Otevřete ponor, upravte ho a u lokality klepněte na „Použít moji polohu“.',
      noSitesGuest: 'Zatím tu nejsou žádné komunitní lokality. Přijdou s účtem, při první synchronizaci.',
      noSitesMember:
        'Zatím tu nejsou žádné komunitní lokality. Lokality přibývají, jak je potápěči přidávají, a další synchronizace je stáhne.',
      noSitePositions_one:
        'Vaše jediná komunitní lokalita zatím nemá polohu. Lokalita přebírá bod ponoru, který ji vytvořil, takže než nějakou přidáte, klepněte na „Použít moji polohu“.',
      noSitePositions_few:
        'Žádná z vašich {{count, figure}} komunitních lokalit zatím nemá polohu. Lokalita přebírá bod ponoru, který ji vytvořil, takže než nějakou přidáte, klepněte na „Použít moji polohu“.',
      noSitePositions_many:
        'Žádná z vašich {{count, figure}} komunitních lokalit zatím nemá polohu. Lokalita přebírá bod ponoru, který ji vytvořil, takže než nějakou přidáte, klepněte na „Použít moji polohu“.',
      noSitePositions_other:
        'Žádná z vašich {{count, figure}} komunitních lokalit zatím nemá polohu. Lokalita přebírá bod ponoru, který ji vytvořil, takže než nějakou přidáte, klepněte na „Použít moji polohu“.',
      noCentresGuest: 'Zatím tu nejsou žádná potápěčská centra. Přijdou s účtem, při první synchronizaci.',
      noCentresMember:
        'Zatím tu nejsou žádná potápěčská centra. Centra přibývají, jak je potápěči přidávají, a další synchronizace je stáhne.',
      noCentrePositions_one:
        'Vaše jediné centrum zatím nemá polohu. Klepnutím na „Všechna centra“ je můžete procházet.',
      noCentrePositions_few:
        'Žádné z vašich {{count, figure}} center zatím nemá polohu. Klepnutím na „Všechna centra“ je můžete procházet.',
      noCentrePositions_many:
        'Žádné z vašich {{count, figure}} center zatím nemá polohu. Klepnutím na „Všechna centra“ je můžete procházet.',
      noCentrePositions_other:
        'Žádné z vašich {{count, figure}} center zatím nemá polohu. Klepnutím na „Všechna centra“ je můžete procházet.',
      nothingSelected:
        'Nic není vybráno. Zapněte své ponory, komunitní lokality nebo potápěčská centra a objeví se na mapě.',
      webUnavailable: 'Samotná mapa potřebuje aplikaci Ponor — verze pro prohlížeč nemá čím kreslit.',
      /** *Místo* is neuter, so the verb moves with the count: *bylo připnuto* against *byla
       * připnuta* — all four forms are reached here, which is rare. */
      webPlaces_one: 'Připnulo by se sem {{count, figure}} místo.',
      webPlaces_few: 'Připnula by se sem {{count, figure}} místa.',
      webPlaces_many: 'Připnulo by se sem {{count, figure}} místa.',
      webPlaces_other: 'Připnulo by se sem {{count, figure}} míst.',
    },

    site: {
      heading: 'Potápěčské lokality',
      notFound: 'Lokalita nenalezena.',
      facts: 'Lokalita',
      defaults: 'Výchozí hodnoty lokality',
      defaultsNote:
        'Když tuto lokalitu vyberete u nového ponoru, tato pole se vyplní — a přepíšou cokoli převzatého z posledního ponoru.',
      searchPlaceholder: 'Hledat lokality',
      close: 'Zavřít lokality',
      noneGuest:
        'Zatím žádné potápěčské lokality. Přijdou s účtem — při první synchronizaci a když nějakou přidáte u ponoru.',
      noneMember:
        'Zatím žádné potápěčské lokality. Pojmenujte lokalitu u ponoru a klepněte na „Přidat“; další synchronizace stáhne ty komunitní.',
      noMatches: 'Hledání neodpovídá žádná lokalita.',
    },

    centre: {
      heading: 'Potápěčská centra',
      notFound: 'Centrum nenalezeno.',
      facts: 'Centrum',
      searchPlaceholder: 'Hledat centra',
      close: 'Zavřít centra',
      noneGuest:
        'Zatím žádná potápěčská centra. Přijdou s účtem — při první synchronizaci a když nějaké přidáte u ponoru.',
      noneMember:
        'Zatím žádná potápěčská centra. Pojmenujte centrum u ponoru a klepněte na „Přidat“; další synchronizace stáhne ta komunitní.',
      noMatches: 'Hledání neodpovídá žádné centrum.',
    },

    search: {
      close: 'Zavřít hledání',
      prompt: 'Hledejte ve svých ponorech podle lokality, centra, buddyho nebo poznámek.',
    },

    account: {
      heading: 'Účet',
      whatItIsFor:
        'Ponor funguje i bez účtu. S účtem se váš deník zálohuje, synchronizuje do dalších zařízení a můžete přidávat potápěčské lokality a centra, která použijí i ostatní.',
      signIn: 'Přihlásit se',
      createAccount: 'Vytvořit účet',
      switchToSignUp: 'Vytvořit si účet',
      switchToSignIn: 'Účet už mám',
      email: 'E-mail',
      emailPlaceholder: 'vy@example.com',
      password: 'Heslo',
      signedInAs: 'Přihlášen jako',
      /** All four forms, and the participle moves with the count as well as the noun —
       * *byl přidán* · *byly přidány* · *bylo přidáno*. English moves only its verb. */
      adopted_one: 'Z tohoto telefonu byl do vašeho deníku přidán {{count, figure}} ponor.',
      adopted_few: 'Z tohoto telefonu byly do vašeho deníku přidány {{count, figure}} ponory.',
      adopted_many: 'Z tohoto telefonu bylo do vašeho deníku přidáno {{count, figure}} ponoru.',
      adopted_other: 'Z tohoto telefonu bylo do vašeho deníku přidáno {{count, figure}} ponorů.',
      signOut: 'Odhlásit se',
      signOutTitle: 'Odhlásit se?',
      signOutBody:
        'Váš deník bude z tohoto zařízení odstraněn. Zůstane ve vašem účtu a po opětovném přihlášení se vrátí.',
      checkEmail: 'Zkontrolujte e-mail',
      sentTo: 'Odesláno na',
      openTheLink: 'Otevřete odkaz v tom e-mailu a pak se tu přihlaste.',
      nothingArrives:
        'Nic nepřišlo? Adresa může být špatně, nebo už k ní účet existuje — zkuste se přihlásit.',
      backToSignIn: 'Zpět na přihlášení',
      noBackendRefused: 'Nastavení Supabase v tomto buildu bylo odmítnuto: {{cause}}',
      noBackendMissing: 'Tento build nemá backend, takže není kam se přihlásit. Chybí: {{missing}}.',
    },

    auth: {
      emailRequired: 'Zadejte svoji e-mailovou adresu.',
      passwordRequired: 'Zadejte svoje heslo.',
      credentialsRejected: 'Tento e-mail a heslo neodpovídají žádnému účtu.',
      emailTaken: 'K tomuto e-mailu už účet existuje — přihlaste se.',
      passwordTooWeak: 'To heslo je příliš slabé — zkuste delší.',
      emailMalformed: 'Tohle nevypadá jako e-mailová adresa.',
      signupDisabled: 'Nové účty jsou teď vypnuté.',
      tooManyTries: 'Příliš mnoho pokusů. Počkejte minutu a zkuste to znovu.',
      confirmationRequired:
        'Tento účet zatím není potvrzený. Otevřete odkaz v e-mailu, který na tu adresu přišel, a pak se přihlaste.',
      serverUnreachable:
        'Server se nepodařilo kontaktovat. Váš deník je v bezpečí v telefonu — zkuste to znovu, až budete online.',
      signInFailed: 'Přihlášení se nezdařilo. Zkuste to znovu.',
      signUpFailed: 'Účet se nepodařilo vytvořit. Zkuste to znovu.',
      signOutUnavailable: 'Odhlášení zatím neumí toto zařízení vyčistit, takže se nic neodhlásilo.',
      wipeFailed: 'Deník v tomto zařízení se nepodařilo vymazat, takže se nic neodhlásilo.',
      unpushedChanges:
        'Tento telefon má ponory, které váš účet ještě nedostal. Připojte se a zkuste to znovu — nic se nevymazalo a jste stále přihlášeni.',
      signOutFailed: 'Deník tohoto zařízení byl vymazán, ale odhlášení se nedokončilo. Zkuste to znovu.',
      startOverUnavailable: 'Tento build neumí vyčistit zařízení, takže se nic nesmazalo.',
      startOverUnpushed:
        'V tomto zařízení smazáno. Váš účet zatím smazání nedostal — připojte se a odejde při příští synchronizaci.',
      startOverFailed:
        'Váš účet je prázdný, ale deník v tomto zařízení se nepodařilo vymazat. Zkuste to znovu.',
      deleteAccountUnavailable:
        'Tento build neumí vyčistit zařízení, takže se nesmazal ani váš účet.',
      deleteAccountFailed:
        'Váš účet se nepodařilo kontaktovat, takže se nic nesmazalo. Zkuste to znovu, až budete online.',
      accountDeletedDeviceKept:
        'Váš účet je smazaný, ale deník v tomto zařízení se nepodařilo vymazat. Odstraněním aplikace ho smažete.',
    },
  },
};
