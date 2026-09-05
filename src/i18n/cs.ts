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
      coverage: '{{onMap}} z {{total}}',
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
    },

    certification: {
      untitled: 'Certifikace',
      cardNumber: 'č. {{number}}',
      issued: 'vydáno {{date}}',
      /** *Platí do* / *platnost skončila* rather than a verb agreeing with the card, so the
       * line reads the same whichever noun a diver has in mind. */
      expires: 'platí do {{date}}',
      expired: 'platnost skončila {{date}}',
    },

    /** *Spotřeba* is feminine, hence *klesla* / *stoupla*. Neutral verbs: the figure moved,
     * and the app does not grade a diver's breathing. */
    trend: {
      steady: 'beze změny',
      down: 'klesla z {{before}}',
      up: 'stoupla z {{before}}',
    },

    stats: {
      rmvWindow_one: 'Průměr z posledního {{count, figure}} ponoru se zaznamenaným plynem.',
      rmvWindow_few: 'Průměr z posledních {{count, figure}} ponorů se zaznamenaným plynem.',
      rmvWindow_many: 'Průměr z posledních {{count, figure}} ponoru se zaznamenaným plynem.',
      rmvWindow_other: 'Průměr z posledních {{count, figure}} ponorů se zaznamenaným plynem.',
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
    },
  },
};
