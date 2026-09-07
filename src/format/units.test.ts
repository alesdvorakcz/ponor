import { setActiveLanguage } from '../i18n';
import {
  DEFAULT_UNIT_SYSTEM,
  figureText,
  displayFigure,
  displayNumber,
  displayValueFor,
  diveFieldQuantity,
  isUnitSystem,
  storedValueFor,
  tankFieldQuantity,
  unitLabel,
  UNIT_SYSTEMS,
} from './units';

describe('unitLabel', () => {
  it('names each of DESIGN.md §3s four pairs on both sides', () => {
    expect(unitLabel('depth', 'metric')).toBe('m');
    expect(unitLabel('depth', 'imperial')).toBe('ft');
    expect(unitLabel('pressure', 'metric')).toBe('bar');
    expect(unitLabel('pressure', 'imperial')).toBe('psi');
    expect(unitLabel('temperature', 'metric')).toBe('°C');
    expect(unitLabel('temperature', 'imperial')).toBe('°F');
    expect(unitLabel('weight', 'metric')).toBe('kg');
    expect(unitLabel('weight', 'imperial')).toBe('lb');
  });

  // The fifth and sixth, added in M3 for the two figures `domain/derived.ts` computes. The rate
  // is the volume's own word with `/min` after it in both systems, which is what stops `l` and
  // `cu ft` from being spelled one way in a gas total and another in an RMV.
  it('names the gas pair, and spells the rate as the volume per minute', () => {
    expect(unitLabel('gasVolume', 'metric')).toBe('l');
    expect(unitLabel('gasVolume', 'imperial')).toBe('cu ft');
    expect(unitLabel('gasRate', 'metric')).toBe(`${unitLabel('gasVolume', 'metric')}/min`);
    expect(unitLabel('gasRate', 'imperial')).toBe(`${unitLabel('gasVolume', 'imperial')}/min`);
  });
});

describe('displayFigure', () => {
  it('leaves a metric figure in the unit it is stored in', () => {
    expect(displayFigure('depth', 24.6, 'metric')).toEqual({ value: '24.6', unit: 'm' });
    expect(displayFigure('pressure', 207.5, 'metric')).toEqual({ value: '208', unit: 'bar' });
    expect(displayFigure('temperature', 25.6, 'metric')).toEqual({ value: '26', unit: '°C' });
    expect(displayFigure('weight', 6.5, 'metric')).toEqual({ value: '6.5', unit: 'kg' });
  });

  // The four conversions, each against a figure worked out from the defining constant
  // rather than from this module's own arithmetic: 24.6 / 0.3048 = 80.7086… ft,
  // 232 bar = 3364.87… psi, 25 °C = 77 °F exactly, 6.5 / 0.45359237 = 14.33 lb.
  it('converts each pair to its imperial half', () => {
    expect(displayFigure('depth', 24.6, 'imperial')).toEqual({ value: '81', unit: 'ft' });
    expect(displayFigure('pressure', 232, 'imperial')).toEqual({ value: '3365', unit: 'psi' });
    expect(displayFigure('temperature', 25, 'imperial')).toEqual({ value: '77', unit: '°F' });
    expect(displayFigure('weight', 6.5, 'imperial')).toEqual({ value: '14', unit: 'lb' });
    // The gas pair, against the defining constant like the four above it: a cubic foot is
    // 0.3048³ m³ = 28.316846592 l exactly, so 2381.7 l is 84.11 cu ft and 18.42 l/min is
    // 0.6505 cu ft/min. Both figures also read differently from their stored value, which is
    // what makes them assertions rather than relabelled litres.
    expect(displayFigure('gasVolume', 2381.7, 'imperial')).toEqual({ value: '84', unit: 'cu ft' });
    expect(displayFigure('gasRate', 18.42, 'imperial')).toEqual({ value: '0.65', unit: 'cu ft/min' });
  });

  // Metric is the stored form for the gas pair too, so both halves are the identity — an RMV a
  // metric diver reads is the number `rmv` returned, rounded and nothing else.
  it('leaves the gas pair untouched in the system it is stored in', () => {
    expect(displayFigure('gasVolume', 2381.7, 'metric')).toEqual({ value: '2382', unit: 'l' });
    expect(displayFigure('gasRate', 18.42, 'metric')).toEqual({ value: '18.4', unit: 'l/min' });
  });

  // The precision decisions in SPECS, each pinned at the boundary where the rule actually
  // bites rather than in its comfortable middle.
  describe('precision', () => {
    it('reads a metric depth to the decimetre and an imperial one to the whole foot', () => {
      // 30.04 m is 98.55 ft: the half-foot boundary, so it must round UP to 99 while the
      // metric side keeps its own second digit. A shared decimal count would print
      // "98.6 ft" here, which claims a resolution of about 3 cm.
      expect(displayFigure('depth', 30.04, 'metric').value).toBe('30.0');
      expect(displayFigure('depth', 30.04, 'imperial').value).toBe('99');
      expect(displayFigure('depth', 30.0, 'imperial').value).toBe('98');
    });

    it('reads whole psi rather than rounding to a coarser step, so a typed figure comes back', () => {
      // 2895 psi is 199.6 bar; rounding the display to the nearest 10 psi would show this
      // diver 2900 for their own entry.
      const stored = storedValueFor('pressure', 2895, undefined, 'imperial');
      expect(displayFigure('pressure', stored as number, 'imperial').value).toBe('2895');
    });

    it('reads whole degrees on both sides of the temperature pair', () => {
      expect(displayFigure('temperature', 3.4, 'imperial').value).toBe('38');
      expect(displayFigure('temperature', 3.6, 'imperial').value).toBe('38');
      expect(displayFigure('temperature', 4.0, 'imperial').value).toBe('39');
    });

    // The one asymmetric pair, and the one `decimals: null` in the table.
    it('shows a metric weight exactly as recorded and an imperial one to the whole pound', () => {
      expect(displayFigure('weight', 6, 'metric').value).toBe('6');
      expect(displayFigure('weight', 6.5, 'metric').value).toBe('6.5');
      expect(displayFigure('weight', 6.25, 'imperial').value).toBe('14');
      expect(displayFigure('weight', 6.8, 'imperial').value).toBe('15');
    });

    /**
     * **The one pair whose two sides do not share a decimal count**, and the reason is the size
     * of the unit: a cubic foot is 28 litres, so one decimal of `cu ft/min` is a step of 0.28
     * l/min across a range (12–22 l/min) that every real diver sits inside. These three — a very
     * good, an ordinary and a heavy-breathing dive — must stay three figures rather than
     * collapsing into two, which is what a `decimals: 1` copied over from the metric side does.
     */
    it('reads an imperial gas rate to two decimals, where one would merge real divers', () => {
      const rates = [12, 17, 22].map((rate) => displayFigure('gasRate', rate, 'imperial').value);
      expect(rates).toEqual(['0.42', '0.60', '0.78']);
      expect(new Set(rates).size).toBe(3);
      // And metric keeps its own single decimal — 18.42 l/min is `18.4`, never `18.42`.
      expect(displayFigure('gasRate', 18.42, 'metric').value).toBe('18.4');
    });

    // A gas total is read to the whole unit on both sides. Imperial is substantially coarser
    // here — a whole cubic foot is 28 litres — and that is the granularity a diver actually
    // states a dive's gas in; the metric whole litre is already finer than the gauge behind it.
    it('reads a gas total to the whole unit in both systems', () => {
      expect(displayFigure('gasVolume', 2381.7, 'metric').value).toBe('2382');
      expect(displayFigure('gasVolume', 2381.7, 'imperial').value).toBe('84');
    });
  });

  // `(-0.4).toFixed(0)` is the string "-0", so formatting the CONVERTED value directly
  // would print "-0 °C" — not a temperature anyone writes, and not what the app printed
  // before units existed. What prevents it is that `displayFigure` rounds to a number
  // first and formats that: `(-0).toFixed(0)` is "0". Collapsing those two steps into one
  // `converted.toFixed(decimals)` is the mutation this reddens on.
  it('never renders a negative zero', () => {
    expect(displayFigure('temperature', -0.4, 'metric').value).toBe('0');
    expect(displayFigure('depth', -0, 'metric').value).toBe('0.0');
    // -17.8 °C is -0.04 °F: the same rounds-to-zero-from-below case one pair over, reached
    // through a conversion rather than sitting in the stored value.
    expect(displayFigure('temperature', -17.8, 'imperial').value).toBe('0');
  });
});

describe('displayNumber', () => {
  it('gives the same figure displayFigure prints, as a number rather than text', () => {
    expect(displayNumber('depth', 24.6, 'imperial')).toBe(81);
    expect(displayNumber('depth', 24.6, 'metric')).toBe(24.6);
    expect(displayNumber('weight', 6.5, 'metric')).toBe(6.5);
  });
});

describe('storedValueFor', () => {
  it('leaves a metric divers own figure completely untouched, unrounded', () => {
    // The value a metric diver typed IS the stored value: no conversion, and therefore no
    // rounding either. 24.63 must not become 24.6 just because the detail screen shows one
    // decimal.
    expect(storedValueFor('depth', 24.63, 24.6, 'metric')).toBe(24.63);
  });

  it('converts an imperial figure back to SI', () => {
    // 81 ft x 0.3048 = 24.6888 m exactly.
    expect(storedValueFor('depth', 81, null, 'imperial')).toBeCloseTo(24.6888, 10);
    expect(storedValueFor('weight', 14, null, 'imperial')).toBeCloseTo(6.35029318, 10);
    expect(storedValueFor('temperature', 77, null, 'imperial')).toBeCloseTo(25, 10);
  });

  // The defect this function exists for: opening a dive in imperial and saving an
  // unrelated change must not re-quantise its stored depth to the nearest foot.
  it('keeps the stored value when the figure on screen still reads as that value', () => {
    expect(storedValueFor('depth', 81, 24.6, 'imperial')).toBe(24.6);
    expect(storedValueFor('pressure', 3365, 232, 'imperial')).toBe(232);
  });

  it('converts once the diver actually changes the figure', () => {
    expect(storedValueFor('depth', 82, 24.6, 'imperial')).toBeCloseTo(24.9936, 10);
  });

  it('leaves a field measuring nothing §3 gives a pair for alone', () => {
    expect(storedValueFor(null, 47, 44, 'imperial')).toBe(47);
  });

  it('passes an absent or unreadable figure straight through, per §1s never block a save', () => {
    expect(storedValueFor('depth', null, 24.6, 'imperial')).toBeNull();
    expect(storedValueFor('depth', Number.NaN, 24.6, 'imperial')).toBeNaN();
  });

  it('converts rather than preserving when the stored value is itself unreadable', () => {
    expect(storedValueFor('depth', 81, Number.NaN, 'imperial')).toBeCloseTo(24.6888, 10);
    expect(storedValueFor('depth', 81, undefined, 'imperial')).toBeCloseTo(24.6888, 10);
  });
});

// The property the form's whole round trip rests on: seed a field from a stored value,
// change nothing, save — and the stored value is the value that comes back.
describe('displayValueFor and storedValueFor are inverses over an untouched field', () => {
  const quantities = ['depth', 'pressure', 'temperature', 'weight'] as const;
  const values = [0, 0.5, 6.5, 24.6, 24.63, 30.04, 207.5, 232, 3000.7];

  it.each(UNIT_SYSTEMS)('round-trips every quantity unchanged in %s', (system) => {
    for (const quantity of quantities) {
      for (const stored of values) {
        const shown = displayValueFor(quantity, stored, system);
        expect(storedValueFor(quantity, shown, stored, system)).toBe(stored);
      }
    }
  });

  it('hands a metric diver the raw stored value rather than a rounded one', () => {
    expect(displayValueFor('depth', 24.63, 'metric')).toBe(24.63);
    expect(displayValueFor('depth', 24.63, 'imperial')).toBe(81);
  });
});

describe('diveFieldQuantity', () => {
  it('classifies the columns that carry one of the four pairs', () => {
    expect(diveFieldQuantity('maxDepthM')).toBe('depth');
    expect(diveFieldQuantity('avgDepthM')).toBe('depth');
    // A distance, so the same pair a depth takes — which is what DiveDetailScreen already
    // assumed by running it through formatDepth.
    expect(diveFieldQuantity('visibilityM')).toBe('depth');
    expect(diveFieldQuantity('waterTempC')).toBe('temperature');
    expect(diveFieldQuantity('airTempC')).toBe('temperature');
    expect(diveFieldQuantity('weightsKg')).toBe('weight');
  });

  it('classifies as unconvertible the numbers that are not measurements in any system', () => {
    expect(diveFieldQuantity('durationMin')).toBeNull();
    expect(diveFieldQuantity('rating')).toBeNull();
    expect(diveFieldQuantity('waves')).toBeNull();
    // Millimetres in both systems — a 5 mm suit is 5 mm everywhere, so this is the fourth
    // no-pair quantity rather than a distance. `'depth'` here would render it as 0.02 ft.
    expect(diveFieldQuantity('suitThicknessMm')).toBeNull();
    expect(diveFieldQuantity('latitude')).toBeNull();
    expect(diveFieldQuantity('longitude')).toBeNull();
    expect(diveFieldQuantity('manualOrder')).toBeNull();
  });
});

describe('tankFieldQuantity', () => {
  it('classifies all three cylinder pressures, and nothing else', () => {
    expect(tankFieldQuantity('workingBar')).toBe('pressure');
    expect(tankFieldQuantity('startBar')).toBe('pressure');
    expect(tankFieldQuantity('endBar')).toBe('pressure');
    // Litres of water capacity: the imperial cylinder unit is the cubic foot, which is
    // free gas at working pressure — a different quantity, not this one converted.
    expect(tankFieldQuantity('sizeL')).toBeNull();
    expect(tankFieldQuantity('configuration')).toBeNull();
    expect(tankFieldQuantity('o2Pct')).toBeNull();
    expect(tankFieldQuantity('hePct')).toBeNull();
  });

  /**
   * **And `sizeL` stays `null` now that a `gasVolume` pair exists** — the one line in that table
   * a later reader is most likely to "fix". A cylinder is described by its water capacity and a
   * cubic foot measures free gas at working pressure: `'gasVolume'` here would render an 11.1 l
   * cylinder as `0.4 cu ft` on the form, the detail and every preset chip. The pair added in M3
   * is for what `domain/derived.ts` computes, which really is free gas.
   *
   * Asserted against the label rather than against `null` alone, because the failure being
   * guarded is a plausible-looking wrong classification, not an absent one.
   */
  it('keeps a cylinder’s water capacity out of the gas pair it is easily mistaken for', () => {
    expect(tankFieldQuantity('sizeL')).not.toBe('gasVolume');
    expect(unitLabel('gasVolume', 'imperial')).toBe('cu ft');
  });
});

describe('isUnitSystem', () => {
  it('accepts exactly the systems this build offers', () => {
    expect(isUnitSystem('metric')).toBe(true);
    expect(isUnitSystem('imperial')).toBe(true);
  });
  it('rejects anything else a stored settings row could hold', () => {
    expect(isUnitSystem('Imperial')).toBe(false);
    expect(isUnitSystem('nautical')).toBe(false);
    expect(isUnitSystem('')).toBe(false);
    expect(isUnitSystem(null)).toBe(false);
    expect(isUnitSystem(undefined)).toBe(false);
    expect(isUnitSystem(1)).toBe(false);
  });
});

describe('DEFAULT_UNIT_SYSTEM', () => {
  it('is metric', () => {
    expect(DEFAULT_UNIT_SYSTEM).toBe('metric');
  });
});

// ---------------------------------------------------------------------------------------
// figureText — the decimal separator (M3g)
// ---------------------------------------------------------------------------------------
//
// §10's depth bands are computed from the stored metre value, so a comma cannot move a dive
// between bands; what it can do is reach a place that parses, and the point of routing every
// fractional figure through one function is that there is one place to check.

describe('figureText', () => {
  afterEach(() => {
    setActiveLanguage('en');
  });

  it('writes a fraction with the mark the language uses', () => {
    expect(figureText(41.2, 1)).toBe('41.2');
    setActiveLanguage('cs');
    expect(figureText(41.2, 1)).toBe('41,2');
  });

  it('leaves a whole number alone in both languages', () => {
    expect(figureText(208, 0)).toBe('208');
    setActiveLanguage('cs');
    expect(figureText(208, 0)).toBe('208');
    // And no grouping — 1284 dives is 1284, not 1,284 or 1 284. `Intl.NumberFormat` was
    // rejected for exactly this: it would rewrite an English figure the app already ships.
    expect(figureText(1284)).toBe('1284');
  });

  it('pads to the pair’s own precision, or shows the value exactly as recorded', () => {
    // The weight spec's `null`: 6 kg reads `6`, never `6.0`.
    expect(figureText(6)).toBe('6');
    expect(figureText(6, 1)).toBe('6.0');
    setActiveLanguage('cs');
    expect(figureText(6, 1)).toBe('6,0');
  });

  it('carries the mark through every figure `displayFigure` builds', () => {
    setActiveLanguage('cs');
    expect(displayFigure('depth', 24.6, 'metric')).toEqual({ value: '24,6', unit: 'm' });
    // The unit words themselves do NOT move: `m`, `bar`, `°C` and `kg` are the same marks in
    // Czech, and `format/units.ts` owns them rather than the resource files.
    expect(displayFigure('pressure', 207.5, 'metric')).toEqual({ value: '208', unit: 'bar' });
    expect(displayFigure('temperature', -0.4, 'metric')).toEqual({ value: '0', unit: '°C' });
  });

  it('does not disturb the numbers the form round-trips, which are never text', () => {
    setActiveLanguage('cs');
    // `displayValueFor`/`storedValueFor` hand each other `number`s, so the comma exists only
    // between the formatter and the diver's eyes — the property §10 asks for in the sentence
    // about depth bands, stated where it could actually break.
    expect(displayValueFor('depth', 24.63, 'imperial')).toBe(81);
    expect(storedValueFor('depth', 81, 24.63, 'imperial')).toBe(24.63);
  });
});
