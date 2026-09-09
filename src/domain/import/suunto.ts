import { type DiveSample } from '../../db/schema';
import { localPartsOf } from '../datetime';
import { decodeUtf8, ImportRefusal, type DiveImporter, type ImportedDive } from './types';

const PASCALS_PER_BAR = 100_000;
const LITRES_PER_CUBIC_METRE = 1000;
const KELVIN_AT_ZERO_C = 273.15;
const SECONDS_PER_MINUTE = 60;

/** A number the file actually carried. A missing key and an explicit `null` are one answer —
 * the pod-less export omits `StartPressure` entirely while its samples set `Pressure: null`. */
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const scaled = (v: unknown, by: number, dp: number): number | null => {
  const n = num(v);
  return n === null ? null : Number((n / by).toFixed(dp));
};

/** Kelvin → Celsius, rounded to 0.1 °C, or null if the file did not carry a real number here.
 * `Temperature` is read through this rather than a bare subtraction so that a malformed value
 * (`true`, a string, `NaN`) cannot produce a plausible-looking fake reading the way
 * `true - KELVIN_AT_ZERO_C` otherwise would — the same guard every other field in this file
 * already gets from `num()`/`scaled()`. */
const celsius = (v: unknown): number | null => {
  const k = num(v);
  return k === null ? null : Number((k - KELVIN_AT_ZERO_C).toFixed(1));
};

/** Seconds from the dive's start, or null if either timestamp cannot be read as a real
 * instant. `Date.parse` returns `NaN` for a malformed string — an offset a firmware wrote
 * wrong is enough — and every other numeric read in this file already guards against exactly
 * that (`num()`, `scaled()`, `celsius()`) rather than trusting `JSON.stringify` to turn the
 * `NaN` into a `null` further down and hoping nobody notices every point in the series got
 * one. `startMs` is checked here too, not only by its one caller: a dive whose own start time
 * cannot be resolved makes every sample's time equally unresolvable. */
const secondsFromStart = (iso: string, startMs: number): number | null => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || !Number.isFinite(startMs)) return null;
  return Number(((ms - startMs) / 1000).toFixed(2));
};

interface SuuntoSample {
  Depth?: number | null;
  Temperature?: number | null;
  TimeISO8601?: string;
  Cylinders?: { Pressure?: number | null }[];
}

export const suuntoJsonImporter: DiveImporter = {
  source: 'suunto-app-json',
  label: () => 'Suunto',

  /** A look, not a parse — it must answer for any bytes at all without throwing, including a
   * truncated file, which it deliberately still claims so `parse` can refuse it by name. */
  recognises(file) {
    const text = decodeUtf8(file);
    return text.includes('"DeviceLog"') && text.includes('"Header"');
  },

  parse(file) {
    let root: any;
    try {
      root = JSON.parse(decodeUtf8(file));
    } catch {
      throw new ImportRefusal('not valid JSON');
    }
    const log = root?.DeviceLog;
    const header = log?.Header;
    const startedAt = typeof header?.DateTime === 'string' ? header.DateTime : null;
    if (!startedAt) throw new ImportRefusal('no dive start time');
    const local = localPartsOf(startedAt);
    // `date` is Ponor's one required column, so a start time it cannot read is a refusal
    // rather than a dive with an invented date.
    if (!local) throw new ImportRefusal('unreadable dive start time');
    // Milliseconds and the offset dropped: one computer cannot record two dives starting in
    // the same second, and a future export writing `Z` or a different precision must not
    // produce a second key for a dive already imported.
    const localKey = `${local.date}T${local.time}:${local.second}`;

    const serial = String(log?.Device?.SerialNumber ?? header?.Device?.SerialNumber ?? 'unknown');
    // Built once and read twice below (the top-level field, and nowhere else — `dive` itself
    // no longer carries a copy; see `ImportedDive.dive`'s own docblock in ./types for why).
    const importId = `${serial}:${localKey}`;
    const startMs = Date.parse(startedAt);

    const samples: SuuntoSample[] = Array.isArray(log?.Samples) ? log.Samples : [];
    // Event-only records carry no depth and are not part of the profile.
    const dived = samples.filter((s) => num(s?.Depth) !== null && typeof s?.TimeISO8601 === 'string');

    // A sample whose own time cannot be resolved — or every sample, if the dive's own start
    // time cannot be — is dropped exactly as one with no depth already is above, rather than
    // written with a computed time that has quietly become `null` (`flatMap` over a
    // one-or-zero-element array, so an unresolvable sample contributes nothing rather than a
    // hole the array index would still count).
    const series: DiveSample[] = dived.flatMap((s): DiveSample[] => {
      // From the sample's own timestamp, never index × SampleInterval: the file declares 10 s
      // and its real deltas run 9.74–10.10, so an index-derived series would drift against the
      // timestamps it claims to represent.
      const time = secondsFromStart(s.TimeISO8601!, startMs);
      if (time === null) return [];
      const sample: DiveSample = [
        time,
        num(s.Depth)!,
        celsius(s.Temperature),
        scaled(s.Cylinders?.[0]?.Pressure, PASCALS_PER_BAR, 1),
      ];
      return [sample];
    });

    // The deepest sample that carries a temperature; ties resolve to the first. Owner's call
    // (2026-09-09): the temperature at depth, not the coldest of the dive.
    const deepest = dived.reduce<SuuntoSample | null>(
      (best, s) =>
        s.Temperature != null && (best === null || num(s.Depth)! > num(best.Depth)!) ? s : best,
      null,
    );

    const gases: any[] = Array.isArray(header?.Diving?.Gases) ? header.Diving.Gases : [];
    const tanks = gases.map((g) => ({
      material: null,
      configuration: null,
      sizeL: scaled(g?.TankSize, 1 / LITRES_PER_CUBIC_METRE, 1),
      workingBar: scaled(g?.TankFillPressure, PASCALS_PER_BAR, 1),
      // Read the pressures themselves. **Not** `TransmitterID`, which is present even on a
      // dive logged without a pod and would make `undefined` look like a reading.
      startBar: scaled(g?.StartPressure, PASCALS_PER_BAR, 1),
      endBar: scaled(g?.EndPressure, PASCALS_PER_BAR, 1),
      o2Pct: scaled(g?.Oxygen, 1 / 100, 0),
      hePct: scaled(g?.Helium, 1 / 100, 0),
    }));

    const duration = num(header?.Duration);
    const dive: ImportedDive = {
      importId,
      series: series.length > 0 ? series : null,
      dive: {
        date: local.date,
        timeIn: local.time,
        // `Duration` is the dive; the samples span 2210.9 s against a stated 2211, so the
        // separate `PauseDuration` is something else and reaches nothing.
        durationMin: duration === null ? null : Math.round(duration / SECONDS_PER_MINUTE),
        // The header's own maximum, which is deeper than any sample: the device records it at
        // a finer resolution than the 10 s series, so deriving it here would under-report
        // every imported dive (24.29 sampled against 24.33 stated).
        maxDepthM: num(header?.Depth?.Max),
        avgDepthM: num(header?.Depth?.Avg),
        waterTempC: celsius(deepest?.Temperature),
        tanks,
        status: 'logged',
      },
    };
    return [dive];
  },
};
