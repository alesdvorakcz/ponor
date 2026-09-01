import { render, type RenderResult } from '@testing-library/react-native';

import { WEATHER_VALUES } from '../domain/types';
import { themeFor } from '../theme/resolve';
import { WeatherIcon } from './WeatherIcon';

// `EntryIcon.test.tsx`'s harness, and its docblock is the one to read: a `SymbolModule`-named
// host node is what tells a real SF Symbol from a drawn approximation, since a hand-rolled
// glyph or a `Text` character would never produce one. `t.root` is included because this
// component renders the symbol as its own outermost element.
function symbolsIn(t: RenderResult) {
  if (!t.root) return [];
  return [t.root, ...t.root.queryAll(() => true)].filter(
    (n) => typeof n.type === 'string' && n.type.includes('SymbolModule'),
  );
}

const INK = themeFor('dark').fg;

// **Every value gets a DIFFERENT symbol, by name.** A component that returned one sky for
// every weather would pass "an icon appears", and the six chips sit in one row where a single
// glyph doing duty for all of them is the most likely way this breaks and the hardest to see
// in a screenshot.
//
// The two cloud levels are the pair worth naming: §10 split `partly` into `cloudy` (some
// cloud) and `overcast` (solid grey) so each member means itself, and the marks have to carry
// that same distinction or the vocabulary's own reason for changing is lost at the one place
// a diver looks.
it.each([
  ['sunny', 'sun.max.fill'],
  ['cloudy', 'cloud.sun.fill'],
  ['overcast', 'cloud.fill'],
  ['rainy', 'cloud.rain.fill'],
  ['windy', 'wind'],
  ['foggy', 'cloud.fog.fill'],
] as const)('draws %s as its own real SF Symbol', async (weather, name) => {
  const t = await render(<WeatherIcon weather={weather} tintColor={INK} />);
  expect(symbolsIn(t)[0]?.props.name).toBe(name);
});

// Swept over the domain's own vocabulary rather than the six rows above, which are a
// hand-typed list and would stay green while a seventh weather rendered nothing. Weather is
// the one field where a bare chip is NOT an acceptable outcome — §0.6 permits a value with no
// mark, but every sky has one, so a missing symbol here is an omission rather than a
// judgement, and it should fail rather than degrade quietly.
it('gives every weather the domain declares a symbol, and no two of them the same one', async () => {
  const names: unknown[] = [];
  for (const weather of WEATHER_VALUES) {
    const t = await render(<WeatherIcon weather={weather} tintColor={INK} />);
    const symbol = symbolsIn(t)[0];
    expect(symbol).toBeDefined();
    names.push(symbol?.props.name);
  }
  expect(new Set(names.map((n) => JSON.stringify(n))).size).toBe(WEATHER_VALUES.length);
});

// §0.6's chip rule: the mark takes the ink of the label beside it. A mark resolving its own
// colour would stay `fg` on the selected chip's `action` ground and vanish on exactly the chip
// the diver picked. Two different values, because a hard-coded colour matching the first would
// pass a single-value assertion.
it('draws in whatever ink it is handed, rather than a colour of its own', async () => {
  const plain = await render(<WeatherIcon weather="rainy" tintColor={themeFor('dark').fg} />);
  expect(symbolsIn(plain)[0]?.props.tintColor).toBe(themeFor('dark').fg);

  const inverted = await render(<WeatherIcon weather="rainy" tintColor={themeFor('dark').actionFg} />);
  expect(symbolsIn(inverted)[0]?.props.tintColor).toBe(themeFor('dark').actionFg);
});

// The same default `EntryIcon` carries, for the same reason: expo-symbols' own is 24, which
// beside a 13.5 px chip label is an icon with a label attached rather than the other way
// round.
it('sits at the label’s own scale by default, and takes a caller’s size when given one', async () => {
  const standard = await render(<WeatherIcon weather="sunny" tintColor={INK} />);
  expect(symbolsIn(standard)[0]?.props.size).toBe(15);

  const larger = await render(<WeatherIcon weather="sunny" tintColor={INK} size={22} />);
  expect(symbolsIn(larger)[0]?.props.size).toBe(22);
});
