import { render, type RenderResult } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { jsTabItems } from '../navigation/tabs';
import { themeFor } from '../theme/resolve';
import { TabBarGlyph } from './TabBarGlyph';

// Host nodes only, `t.root` included (CarriedMark.test.tsx records why): the glyph is this
// component's outermost element, so a sweep of descendants alone would never see it.
function hostNodes(t: RenderResult) {
  if (!t.root) return [];
  return [t.root, ...t.root.queryAll(() => true)].filter((n) => typeof n.type === 'string');
}

function symbolsIn(t: RenderResult) {
  return hostNodes(t).filter((n) => (n.type as string).includes('SymbolModule'));
}

function imagesIn(t: RenderResult) {
  return hostNodes(t).filter((n) => n.type === 'Image');
}

function tab(name: string) {
  const found = jsTabItems().find((item) => item.name === name);
  if (!found) throw new Error(`no ${name} tab in the bar`);
  return found;
}

// The navigator hands each glyph the ink for its state — resting or selected — and its own
// size. Two of each, from the theme, so a glyph that hard-coded either one (or ignored the
// value it was given) fails here: with a single ink, a constant `fgMuted` would pass, and the
// browser's selected tab would never change ink.
const RESTING = themeFor('dark').fgMuted;
const SELECTED = themeFor('dark').fg;

it.each([
  [RESTING, 24],
  [SELECTED, 18],
])('draws a symbol tab through SymbolView in the navigator’s ink %s and size %d', async (ink, size) => {
  const t = await render(<TabBarGlyph icon={tab('map').icon} color={ink} size={size} />);
  const symbols = symbolsIn(t);
  expect(symbols).toHaveLength(1);
  expect(symbols[0]?.props.tintColor).toBe(ink);
  expect(symbols[0]?.props.size).toBe(size);
  expect(imagesIn(t)).toHaveLength(0);
});

// Ponor's own glyphs are images, and an untinted image would draw the PNG's own white:
// invisible on the light theme's bar and the wrong ink on the dark one.
it.each([
  ['index', RESTING, 24],
  ['settings', SELECTED, 18],
])('draws the %s tab’s glyph as an image in the navigator’s ink %s and size %d', async (name, ink, size) => {
  const t = await render(<TabBarGlyph icon={tab(name).icon} color={ink} size={size} />);
  const images = imagesIn(t);
  expect(images).toHaveLength(1);
  expect(StyleSheet.flatten(images[0]?.props.style)).toMatchObject({ width: size, height: size, tintColor: ink });
  expect(symbolsIn(t)).toHaveLength(0);
});
