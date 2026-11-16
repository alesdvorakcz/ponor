import { render, type RenderResult } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { jsTabItems } from '../navigation/tabs';
import { themeFor } from '../theme/resolve';
import { TabBarGlyph } from './TabBarGlyph';

// Host nodes only, `t.root` included (EntryIcon.test.tsx records why): the glyph is this
// component's outermost element, so a sweep of descendants alone would never see it.
function hostNodes(t: RenderResult) {
  if (!t.root) return [];
  return [t.root, ...t.root.queryAll(() => true)].filter((n) => typeof n.type === 'string');
}

const INK = themeFor('dark').fgMuted;

function tab(name: string) {
  const found = jsTabItems().find((item) => item.name === name);
  if (!found) throw new Error(`no ${name} tab in the bar`);
  return found;
}

it('draws a symbol tab through SymbolView, in the navigator’s ink and size', async () => {
  const t = await render(<TabBarGlyph icon={tab('map').icon} color={INK} size={24} />);
  const symbols = hostNodes(t).filter((n) => (n.type as string).includes('SymbolModule'));
  expect(symbols).toHaveLength(1);
  expect(hostNodes(t).filter((n) => n.type === 'Image')).toHaveLength(0);
});

// The mark is an image, and an untinted image would draw the PNG's own white: invisible on the
// light theme's bar and the wrong ink on the dark one. So the tint and the size are the
// navigator's — the same two values a symbol gets — and they change with the selection.
it('draws the Dives mark as an image, tinted and sized by the navigator', async () => {
  const t = await render(<TabBarGlyph icon={tab('index').icon} color={INK} size={24} />);
  const images = hostNodes(t).filter((n) => n.type === 'Image');
  expect(images).toHaveLength(1);
  const style = StyleSheet.flatten(images[0]?.props.style);
  expect(style).toMatchObject({ width: 24, height: 24, tintColor: INK });
  expect(hostNodes(t).filter((n) => (n.type as string).includes('SymbolModule'))).toHaveLength(0);
});
