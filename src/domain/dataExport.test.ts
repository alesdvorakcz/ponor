import { setActiveLanguage } from '../i18n';
import { csvExport, isOwnCatalogueRow, jsonExport, type ExportSource } from './dataExport';
import { dive } from './diveFixture';
import type { Certification, DiveCenter, DiveSite, GearPreset, Tank } from './types';

/**
 * **Asserted against literal expected text, never against a reader of our own.**
 *
 * The trap this file exists to avoid is named in M3i's brief: *a test that exports and then
 * parses its own output is checking your parser against your writer, and they will agree about
 * a bug in both.* So the CSV cases below spell out the file — the whole header row, and whole
 * data rows, commas and empty positions included. A column that loses its value, or a header
 * that stops matching the cell beneath it, shows up as a diff of text a reviewer can read.
 *
 * The JSON cases assert a literal prefix and literal fragments for the same reason. `JSON.parse`
 * appears only where the question is genuinely about structure, and it is the platform's parser
 * rather than one written here, so it cannot agree with `JSON.stringify` about a mistake of
 * ours.
 *
 * **Every test restores English.** The decimal-mark case below puts the app into Czech, and the
 * i18next instance is a module global by design (src/i18n), so a suite that left it there would
 * leak into whichever file the worker picked up next.
 */
afterEach(() => {
  setActiveLanguage('en');
});

const tank = (over: Partial<Tank> = {}): Tank => ({
  material: null,
  configuration: null,
  sizeL: null,
  workingBar: null,
  o2Pct: null,
  hePct: null,
  startBar: null,
  endBar: null,
  ...over,
});

const source = (over: Partial<ExportSource> = {}): ExportSource => ({
  dives: [],
  gearPresets: [],
  certifications: [],
  diveSites: [],
  diveCenters: [],
  divesBefore: 0,
  exportedAt: '2026-09-06T08:30:00.000Z',
  exportedOn: '2026-09-06',
  ...over,
});

/**
 * The header row a metric diver's file starts with, spelled out. Forty columns: §6's clusters
 * in order, then one cylinder block.
 *
 * It is written here rather than derived from the module, which is the whole point — a header
 * built by asking the code what its headers are would agree with any renaming, any reordering
 * and any column silently lost.
 */
const METRIC_HEADER =
  'computed_dive_number,status,date,time_in,duration_min,site,center,entry,salinity,water_body,' +
  'latitude,longitude,max_depth_m,avg_depth_m,water_temp_c,air_temp_c,visibility,visibility_m,' +
  'waves,current,surge,weather,suit,suit_thickness_mm,equipment,weights_kg,weights_feel,buddy,' +
  'guide,title,notes,rating,cylinder_1_material,cylinder_1_configuration,cylinder_1_size_l,' +
  'cylinder_1_working_pressure_bar,cylinder_1_o2_pct,cylinder_1_he_pct,' +
  'cylinder_1_start_pressure_bar,cylinder_1_end_pressure_bar';

/** The same forty columns for an imperial diver — four headers differ, and they are the four
 * §3 gives a unit pair. */
const IMPERIAL_HEADER =
  'computed_dive_number,status,date,time_in,duration_min,site,center,entry,salinity,water_body,' +
  'latitude,longitude,max_depth_ft,avg_depth_ft,water_temp_f,air_temp_f,visibility,visibility_ft,' +
  'waves,current,surge,weather,suit,suit_thickness_mm,equipment,weights_lb,weights_feel,buddy,' +
  'guide,title,notes,rating,cylinder_1_material,cylinder_1_configuration,cylinder_1_size_l,' +
  'cylinder_1_working_pressure_psi,cylinder_1_o2_pct,cylinder_1_he_pct,' +
  'cylinder_1_start_pressure_psi,cylinder_1_end_pressure_psi';

/** The file with its byte-order mark taken off, split into records. The mark is `format/csv.ts`'s
 * and is asserted there by code point; here it would only be an invisible character in front of
 * every expectation. */
const records = (text: string): string[] => text.slice(1).split('\r\n');

/** The awkward note the brief asks for by name: a quote, a comma and a newline in one value. */
const AWKWARD_NOTE = 'said ",\nthen left';

/** The site name §5 names as the duplicate case, and the one that decides whether a spreadsheet
 * shows Czech or mojibake. */
const CZECH_SITE = 'Divoká Šárka';

const almostEmpty = dive({ date: '2026-08-16' });

const full = dive({
  date: '2026-08-17',
  timeIn: '09:15',
  durationMin: 47,
  siteName: CZECH_SITE,
  maxDepthM: 24.6,
  waterTempC: 12,
  equipment: ['hood', 'torch'],
  weightsKg: 6.5,
  notes: AWKWARD_NOTE,
  rating: 4,
  tanks: [
    tank({
      material: 'steel',
      configuration: 'single',
      sizeL: 12,
      workingBar: 232,
      o2Pct: 32,
      startBar: 210,
      endBar: 60,
    }),
  ],
});

describe('csvExport — the header row', () => {
  it('names every column, in metric', () => {
    expect(records(csvExport(source(), 'metric').text)[0]).toBe(METRIC_HEADER);
  });

  it('names the diver’s own units in the four columns that have a pair', () => {
    expect(records(csvExport(source(), 'imperial').text)[0]).toBe(IMPERIAL_HEADER);
  });

  it('is the whole file for a logbook with no dives', () => {
    // "Nothing here" and "the export failed" are different answers, and a header row on its own
    // is the first one.
    expect(csvExport(source(), 'metric').text.slice(1)).toBe(`${METRIC_HEADER}\r\n`);
  });
});

describe('csvExport — a whole file, written out', () => {
  it('is exactly this, for a metric diver with 100 dives before Ponor', () => {
    const text = csvExport(
      source({ dives: [full, almostEmpty], divesBefore: 100 }),
      'metric',
    ).text;
    expect(text.slice(1)).toBe(
      [
        METRIC_HEADER,
        // The dive with almost nothing on it: three values and thirty-seven empty positions,
        // still in their columns. §0.4 — a gap is not a zero and not an empty string that reads
        // as a value.
        '101,logged,2026-08-16,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
        // The full one. The note is quoted and its quote doubled; the Czech site name is
        // untouched; the equipment set is one space-separated cell.
        '102,logged,2026-08-17,09:15,47,Divoká Šárka,,,,,,,24.6,,12,,,,,,,,,,hood torch,6.5,,,,,' +
          '"said "",\nthen left",4,steel,single,12,232,32,,210,60',
        '',
      ].join('\r\n'),
    );
  });

  it('converts the figures and leaves the text alone, for an imperial diver', () => {
    const text = csvExport(source({ dives: [full], divesBefore: 0 }), 'imperial').text;
    expect(records(text)[1]).toBe(
      // 24.6 m is 81 ft, 12 °C is 54 °F, 6.5 kg is 14 lb, and 232/210/60 bar are
      // 3365/3046/870 psi. The cylinder's 12 L stays 12 L: a cubic foot measures free gas
      // rather than water capacity, so §3's four pairs do not include one (format/units.ts).
      '1,logged,2026-08-17,09:15,47,Divoká Šárka,,,,,,,81,,54,,,,,,,,,,hood torch,14,,,,,' +
        '"said "",\nthen left",4,steel,single,12,3365,32,,3046,870',
    );
  });
});

describe('csvExport — the computed dive number', () => {
  it('is the only computed column, and its header says so', () => {
    const header = records(csvExport(source(), 'metric').text)[0] ?? '';
    expect(header.startsWith('computed_dive_number,')).toBe(true);
    // The five other values §6 lists as computed are deliberately absent: each is one formula
    // away from columns that ARE here, and a derived figure in a grid of recorded ones has
    // nothing to mark it (§0.6's `=` is a formula to a spreadsheet).
    for (const absent of ['surface_interval', 'used_bar', 'rmv', 'mod', 'nitrogen', 'time_out']) {
      expect(header).not.toContain(absent);
    }
  });

  it('offsets by the diver’s pre-Ponor count', () => {
    const text = csvExport(source({ dives: [almostEmpty], divesBefore: 247 }), 'metric').text;
    expect(records(text)[1]?.startsWith('248,logged,')).toBe(true);
  });

  it('falls back to no offset when the stored count cannot be read', () => {
    // `readExportSource` hands the raw settings value through unchanged, so a corrupt row
    // degrades here exactly as it does on the dive list — offset 0 — rather than costing the
    // diver their export.
    const text = csvExport(source({ dives: [almostEmpty], divesBefore: '0x10' }), 'metric').text;
    expect(records(text)[1]?.startsWith('1,logged,')).toBe(true);
  });

  it('leaves a planned dive’s number empty and says planned', () => {
    // §2.4: a planned dive has no dive number until it is completed. An empty cell, not a 0.
    const planned = dive({ date: '2026-08-18', status: 'planned' });
    const text = csvExport(source({ dives: [almostEmpty, planned] }), 'metric').text;
    expect(records(text)[1]?.startsWith('1,logged,2026-08-16,')).toBe(true);
    expect(records(text)[2]?.startsWith(',planned,2026-08-18,')).toBe(true);
  });
});

describe('csvExport — order', () => {
  it('writes the dives oldest first, whatever order they arrive in', () => {
    const first = dive({ date: '2026-08-16' });
    const second = dive({ date: '2026-08-17' });
    const third = dive({ date: '2026-08-18' });
    const text = csvExport(source({ dives: [third, first, second] }), 'metric').text;
    expect(records(text).slice(1, 4).map((line) => line.slice(0, 12))).toEqual([
      '1,logged,202',
      '2,logged,202',
      '3,logged,202',
    ]);
    expect(records(text)[1]).toContain('2026-08-16');
    expect(records(text)[3]).toContain('2026-08-18');
  });
});

describe('csvExport — cylinders', () => {
  const three = dive({
    date: '2026-08-20',
    tanks: [
      tank({ material: 'steel', startBar: 200 }),
      tank({ material: 'alu', startBar: 190 }),
      tank({ material: 'alu', startBar: 180 }),
    ],
  });

  it('gives every cylinder its own block, sized to the widest rig in the logbook', () => {
    const header = records(csvExport(source({ dives: [almostEmpty, three] }), 'metric').text)[0] ?? '';
    expect(header).toContain('cylinder_1_material');
    expect(header).toContain('cylinder_2_material');
    expect(header).toContain('cylinder_3_end_pressure_bar');
    expect(header).not.toContain('cylinder_4_');
  });

  it('writes every cylinder’s pressure, not just the first', () => {
    const line = records(csvExport(source({ dives: [three] }), 'metric').text)[1] ?? '';
    expect(line.endsWith(',steel,,,,,,200,,alu,,,,,,190,,alu,,,,,,180,')).toBe(true);
  });

  it('leaves the blocks a dive does not fill as empty positions', () => {
    const text = csvExport(source({ dives: [full, three] }), 'metric').text;
    // `full` has one cylinder in a logbook whose widest rig is three, so its row still carries
    // three blocks and the last two are empty.
    expect(records(text)[1]?.endsWith(',steel,single,12,232,32,,210,60,,,,,,,,,,,,,,,,')).toBe(true);
  });

  it('keeps one block for a logbook that has recorded no cylinder at all', () => {
    const header = records(csvExport(source({ dives: [almostEmpty] }), 'metric').text)[0] ?? '';
    expect(header).toContain('cylinder_1_material');
    expect(header).not.toContain('cylinder_2_');
  });
});

describe('csvExport — the decimal mark', () => {
  it('stays a point when the app is in Czech', () => {
    // `figureText` (format/units.ts) writes `41,2` for a Czech reader, and is right to — for a
    // sentence. A comma inside a number in a comma-separated file is the one ambiguity the
    // quoting rules exist to prevent, and it would make a Czech diver's archive a different
    // format from an English diver's.
    setActiveLanguage('cs');
    const line = records(csvExport(source({ dives: [full] }), 'metric').text)[1] ?? '';
    expect(line).toContain(',24.6,');
    expect(line).not.toContain('24,6');
  });
});

describe('csvExport — the file name', () => {
  it('is the app, the sheet and the day it was taken', () => {
    expect(csvExport(source(), 'metric').name).toBe('ponor-dives-2026-09-06.csv');
  });
});

describe('jsonExport', () => {
  const site: DiveSite = {
    id: 'site-1',
    name: CZECH_SITE,
    country: 'CZ',
    latitude: 50.1,
    longitude: 14.3,
    salinity: 'fresh',
    waterBody: 'quarry',
    entry: 'shore',
    maxDepthM: 18,
    createdBy: 'me',
    status: 'active',
    mergedInto: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
    dirty: false,
  };
  const preset: GearPreset = {
    id: 'preset-1',
    name: 'twin 12 steel',
    tanks: [tank({ material: 'steel', configuration: 'twinset', sizeL: 12 })],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
    dirty: false,
  };
  const card: Certification = {
    id: 'cert-1',
    agency: 'SSI',
    course: 'Open Water',
    cardNumber: '12345',
    issuedOn: '2020-05-01',
    expiresOn: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
    dirty: false,
  };

  it('opens with what the file is, when it was taken and what units it is in', () => {
    const text = jsonExport(source({ divesBefore: 100 })).text;
    expect(
      text.startsWith(
        '{\n' +
          '  "format": "ponor-logbook-export",\n' +
          '  "version": 1,\n' +
          '  "exportedAt": "2026-09-06T08:30:00.000Z",\n' +
          '  "units": "si",\n' +
          '  "divesBefore": 100,\n',
      ),
    ).toBe(true);
  });

  it('writes a pre-Ponor count it cannot read as null rather than as nought', () => {
    // A `0` here would silently renumber a rebuilt logbook by the diver's whole history.
    expect(jsonExport(source({ divesBefore: 'nonsense' })).text).toContain('"divesBefore": null');
  });

  it('is SI whatever the diver’s Settings say, because nothing here takes a unit system', () => {
    // The signature is the guarantee: `jsonExport` has no `system` parameter to be given the
    // wrong one, and the depth below is the stored metre value.
    expect(jsonExport(source({ dives: [full] })).text).toContain('"maxDepthM": 24.6');
  });

  it('carries every table the export covers', () => {
    const text = jsonExport(
      source({
        dives: [full],
        gearPresets: [preset],
        certifications: [card],
        diveSites: [site],
        diveCenters: [],
      }),
    ).text;
    expect(text).toContain('"twin 12 steel"');
    expect(text).toContain('"Open Water"');
    expect(text).toContain('"12345"');
    expect(text).toContain(`"name": "${CZECH_SITE}"`);
    expect(text).toContain('"diveCenters": []');
  });

  it('keeps a diver’s awkward note exactly, escaped by JSON’s own rules', () => {
    expect(jsonExport(source({ dives: [full] })).text).toContain(
      '"notes": "said \\",\\nthen left"',
    );
  });

  it('leaves out the sync flag, which is this phone’s and not the diver’s', () => {
    const text = jsonExport(
      source({ dives: [full], gearPresets: [preset], certifications: [card], diveSites: [site] }),
    ).text;
    expect(text).not.toContain('"dirty"');
  });

  it('writes the dives in the same order the sheet does', () => {
    const text = jsonExport(
      source({ dives: [dive({ date: '2026-08-18' }), dive({ date: '2026-08-16' })] }),
    ).text;
    expect(text.indexOf('2026-08-16')).toBeLessThan(text.indexOf('2026-08-18'));
  });

  it('ends with a newline, so the file is a whole line', () => {
    expect(jsonExport(source()).text.endsWith('}\n')).toBe(true);
  });

  it('is named for the app, the whole logbook and the day it was taken', () => {
    expect(jsonExport(source()).name).toBe('ponor-logbook-2026-09-06.json');
  });

  it('is valid JSON, checked with the platform’s parser rather than one of ours', () => {
    const parsed: unknown = JSON.parse(
      jsonExport(source({ dives: [full], diveSites: [site] })).text,
    );
    expect((parsed as { dives: unknown[] }).dives).toHaveLength(1);
    expect((parsed as { diveSites: unknown[] }).diveSites).toHaveLength(1);
  });
});

describe('isOwnCatalogueRow', () => {
  const row = (over: Partial<Pick<DiveSite, 'createdBy' | 'dirty'>>) => ({
    createdBy: null,
    dirty: false,
    ...over,
  });

  it('claims a row the server says this diver created', () => {
    expect(isOwnCatalogueRow(row({ createdBy: 'me' }), 'me')).toBe(true);
  });

  it('does not claim another diver’s row', () => {
    expect(isOwnCatalogueRow(row({ createdBy: 'someone-else' }), 'me')).toBe(false);
  });

  it('claims a row created on this device that has not been pushed yet', () => {
    // `created_by` is stripped on the way in (db/catalogue.ts's SERVER_AUTHORED), so a site
    // added on a boat has none until a push is echoed back. On `created_by` alone this is
    // exactly the row an export would drop.
    expect(isOwnCatalogueRow(row({ createdBy: null, dirty: true }), 'me')).toBe(true);
  });

  it('claims an unpushed row even with nobody signed in', () => {
    expect(isOwnCatalogueRow(row({ createdBy: null, dirty: true }), null)).toBe(true);
  });

  it('does not claim a clean row whose author is unknown', () => {
    // §5 severs authorship when a diver deletes their account, so a null `created_by` on a
    // pulled row is somebody else's — which is why the two tiers are separate conditions.
    expect(isOwnCatalogueRow(row({ createdBy: null }), 'me')).toBe(false);
  });

  it('claims nothing at all when nobody is signed in and nothing is pending', () => {
    expect(isOwnCatalogueRow(row({ createdBy: 'me' }), null)).toBe(false);
  });

  it('does not read two unknowns as a match', () => {
    // Nobody signed in, and a pulled row whose author has deleted their account. Without the
    // `ownerId !== null` guard these two nulls compare equal and the export would claim a
    // stranger's site as this diver's data.
    expect(isOwnCatalogueRow(row({ createdBy: null }), null)).toBe(false);
  });
});

describe('a centre is the same question as a site', () => {
  it('is answered by the same rule', () => {
    const center: Pick<DiveCenter, 'createdBy' | 'dirty'> = { createdBy: 'me', dirty: false };
    expect(isOwnCatalogueRow(center, 'me')).toBe(true);
  });
});
