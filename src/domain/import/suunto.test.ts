// src/domain/import/suunto.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ImportRefusal } from './types';
import { suuntoJsonImporter } from './suunto';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, '__fixtures__', `${name}.json`)));

const only = (name: string) => {
  const [dive] = suuntoJsonImporter.parse(fixture(name));
  if (!dive) throw new Error('no dive parsed');
  return dive;
};

it('recognises a Suunto export and refuses a JSON that is not one', () => {
  expect(suuntoJsonImporter.recognises(fixture('suunto-d5'))).toBe(true);
  expect(suuntoJsonImporter.recognises(new TextEncoder().encode('{"a":1}'))).toBe(false);
});

it('refuses a file it owns but cannot read, which is not the same as not recognising it', () => {
  const truncated = new TextEncoder().encode('{"DeviceLog":{"Header":{"DateTime":');
  expect(suuntoJsonImporter.recognises(truncated)).toBe(true);
  expect(() => suuntoJsonImporter.parse(truncated)).toThrow(ImportRefusal);
});

it('reads the local wall clock and does not convert it through UTC', () => {
  // +08:00 in the fixture. Converting would file this dive on 2026-02-19 at 03:22 UTC, and
  // §10 names exactly that trap. The date and time are the diver's, as written.
  const { dive } = only('suunto-d5');
  expect(dive.date).toBe('2026-02-19');
  expect(dive.timeIn).toBe('11:22');
});

it('takes max depth from the header, which is deeper than any sample', () => {
  // The device records its true maximum at a finer resolution than the 10 s series, so
  // deriving it from the samples under-reports every imported dive.
  const { dive, series } = only('suunto-d5');
  expect(dive.maxDepthM).toBe(24.33);
  expect(Math.max(...(series ?? []).map((s) => s[1]))).toBeLessThan(24.33);
});

it('records the temperature at the deepest sample, not the coldest of the dive', () => {
  const { dive } = only('suunto-d5');
  expect(dive.waterTempC).toBeCloseTo(27.4, 1);
});

it('converts the gas block into a tank, in Ponor’s units', () => {
  const { dive } = only('suunto-d5');
  expect(dive.tanks?.[0]).toMatchObject({
    sizeL: 12,          // 0.012 m³
    workingBar: 200,    // 20000000 Pa
    startBar: 188.9,    // 18889062 Pa
    endBar: 72.5,       // 7245312 Pa
    o2Pct: 21,          // 0.21
    hePct: 0,
  });
});

it('rounds the duration to whole minutes and ignores PauseDuration', () => {
  // 2211 s is the dive; the samples span 2210.9 s, so the separate PauseDuration is something
  // else and must reach nothing.
  const { dive } = only('suunto-d5');
  expect(dive.durationMin).toBe(37);
});

it('times the series from its own timestamps, never from index × interval', () => {
  // The file declares SampleInterval 10 and its real deltas drift, so an index-derived series
  // would disagree with the timestamps it claims to represent.
  const { series } = only('suunto-d5');
  expect(series?.[0]?.[0]).toBeCloseTo(0.57, 2);
  expect(series?.[0]?.[0]).not.toBe(0);
});

it('drops samples carrying no depth, which are the event-only records', () => {
  const { series } = only('suunto-d5');
  expect(series?.every((s) => typeof s[1] === 'number')).toBe(true);
});

it('keys a dive on its computer and its local start, to the second', () => {
  const { importId } = only('suunto-d5');
  expect(importId).toBe('000000000000:2026-02-19T11:22:08');
});

it('imports a dive logged without a transmitter, leaving the pressures blank', () => {
  // Verified against a real export: the header OMITS StartPressure/EndPressure as keys while
  // the samples keep Cylinders[0].Pressure and set it null — two shapes for one absence. And
  // TransmitterID is still present, so it is not the signal.
  const { dive, series } = only('suunto-d5-no-transmitter');
  expect(dive.tanks?.[0]).toMatchObject({ sizeL: 12, workingBar: 200, o2Pct: 21 });
  expect(dive.tanks?.[0]?.startBar).toBeNull();
  expect(dive.tanks?.[0]?.endBar).toBeNull();
  expect(series?.every((s) => s[3] === null)).toBe(true);
});

it('invents nothing the file does not carry', () => {
  const { dive } = only('suunto-d5');
  for (const field of ['siteName', 'centerName', 'buddy', 'guide', 'notes', 'title', 'rating',
                       'weightsKg', 'suit', 'entry', 'salinity', 'waterBody', 'latitude',
                       'longitude', 'airTempC', 'visibility', 'weather'] as const) {
    expect(dive[field] ?? null).toBeNull();
  }
});

it('marks where the dive came from, so a re-import can find it again', () => {
  const { dive } = only('suunto-d5');
  expect(dive.importSource).toBe('suunto-app-json');
  expect(dive.status).toBe('logged');
});

it('refuses a fabricated Temperature rather than turning it into a plausible-looking reading', () => {
  // `true - 273.15` is a real, finite number that looks exactly like a plausible reading —
  // every sibling field (Depth, Pressure, ...) reads through num() and would correctly
  // answer null for the same input. Built inline rather than added to a fixture: no real
  // Suunto export carries a boolean here, so this is adversarial input, not a device shape.
  const poisoned = new TextEncoder().encode(
    JSON.stringify({
      DeviceLog: {
        Header: { DateTime: '2026-01-01T10:00:00.000+00:00', Depth: { Max: 5, Avg: 5 } },
        Samples: [{ Depth: 5, Temperature: true, TimeISO8601: '2026-01-01T10:00:05.000+00:00' }],
      },
    }),
  );
  const [imported] = suuntoJsonImporter.parse(poisoned);
  if (!imported) throw new Error('no dive parsed');
  // The per-sample series reading.
  expect(imported.series?.[0]?.[2]).toBeNull();
  // The waterTempC read from the deepest (here, only) sample.
  expect(imported.dive.waterTempC).toBeNull();
});
