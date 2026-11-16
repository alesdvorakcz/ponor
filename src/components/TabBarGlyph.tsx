import { SymbolView } from 'expo-symbols';
import { Image, type ColorValue } from 'react-native';

import { type JsTabIcon } from '../navigation/tabs';

export interface TabBarGlyphProps {
  icon: JsTabIcon;
  /** The navigator's ink for this tab's state — resting or selected. */
  color: ColorValue;
  /** The navigator's glyph size. */
  size: number;
}

/**
 * **One tab's glyph in the browser's bar** (`(tabs)/_layout.web.tsx`): a symbol through
 * `SymbolView`, or one of Ponor's own glyphs (issue #2: the mark, the sliders) as an image.
 *
 * It is a component rather than a ternary in the layout because nothing under `src/app/` can
 * be tested (navigation/tabs.ts records why), and this is the one choice the browser's bar
 * makes per tab. Both arms take the navigator's `color` and `size`, so the mark changes ink
 * with the selection exactly as the symbols beside it do: the PNG is one colour over a
 * transparent ground, and `tintColor` repaints every pixel of it.
 *
 * The device never comes here — its bar is `NativeTabs`, which finds the same drawings as
 * vectors in the app's own assets (`plugins/withTabGlyphs.js`) through `nativeTabItems()`.
 */
export function TabBarGlyph({ icon, color, size }: TabBarGlyphProps) {
  if ('image' in icon) {
    return (
      <Image source={icon.image} accessible={false} style={{ width: size, height: size, tintColor: color }} />
    );
  }
  return <SymbolView name={icon.name} size={size} tintColor={color} />;
}
