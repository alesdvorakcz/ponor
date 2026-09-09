import { type DiveSample } from '../../db/schema';
import { decodeUtf8, ImportRefusal, type DiveImporter, type ImportedDive } from './types';

const PASCALS_PER_BAR = 100_000;
const LITRES_PER_CUBIC_METRE = 1000;
const KELVIN_AT_ZERO_C = 273.15;
const SECONDS_PER_MINUTE = 60;

/**
 * `2026-02-19T11:22:08.290+08:00` → the diver's own date, minute and dedupe key.
 *
 * **Read out of the string, never through a `Date`.** §10 names the trap: `toISOString()` on a
 * dive picked late in the evening east of Greenwich files it under the previous day. The two
 * reference dives make it concrete — the same device wrote `+08:00` on one and `+02:00` on the
 * other, so the offset varies inside one logbook and is deliberately discarded.
 *
 * The key drops milliseconds and the offset: one computer cannot record two dives starting in
 * the same second, and a future export writing `Z` or a different precision must not produce a
 * second key for a dive already imported.
 */
function localParts(dateTime: string): { date: string; time: string; key: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?/.exec(dateTime);
  if (!m?.[1] || !m[2]) return null;
  return { date: m[1], time: m[2], key: `${m[1]}T${m[2]}${m[3] ?? ':00'}` };
}

/** A number the file actually carried. A missing key and an explicit `null` are one answer —
 * the pod-less export omits `StartPressure` entirely while its samples set `Pressure: null`. */
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const scaled = (v: unknown, by: number, dp: number): number | null => {
  const n = num(v);
  return n === null ? null : Number((n / by).toFixed(dp));
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
    const local = localParts(startedAt);
    // `date` is Ponor's one required column, so a start time it cannot read is a refusal
    // rather than a dive with an invented date.
    if (!local) throw new ImportRefusal('unreadable dive start time');

    const serial = String(log?.Device?.SerialNumber ?? header?.Device?.SerialNumber ?? 'unknown');
    const startMs = Date.parse(startedAt);

    const samples: SuuntoSample[] = Array.isArray(log?.Samples) ? log.Samples : [];
    // Event-only records carry no depth and are not part of the profile.
    const dived = samples.filter((s) => num(s?.Depth) !== null && typeof s?.TimeISO8601 === 'string');

    const series: DiveSample[] = dived.map((s) => [
      // From the sample's own timestamp, never index × SampleInterval: the file declares 10 s
      // and its real deltas run 9.74–10.10, so an index-derived series would drift against the
      // timestamps it claims to represent.
      Number(((Date.parse(s.TimeISO8601!) - startMs) / 1000).toFixed(2)),
      num(s.Depth)!,
      s.Temperature == null ? null : Number((s.Temperature - KELVIN_AT_ZERO_C).toFixed(1)),
      scaled(s.Cylinders?.[0]?.Pressure, PASCALS_PER_BAR, 1),
    ]);

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
      importId: `${serial}:${local.key}`,
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
        waterTempC:
          deepest?.Temperature == null ? null : Number((deepest.Temperature - KELVIN_AT_ZERO_C).toFixed(1)),
        tanks,
        status: 'logged',
        importSource: 'suunto-app-json',
        importId: `${serial}:${local.key}`,
      },
    };
    return [dive];
  },
};
