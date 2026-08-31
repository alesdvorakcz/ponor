import type { ColorValue } from 'react-native';

import { type ColorScheme } from '../theme/tokens';

/**
 * **The tab bar's ground, which is a platform question and not a design one.**
 *
 * On iOS and Android the bar draws its own material — on iOS 26 that is Liquid Glass, and
 * getting it is the entire reason `(tabs)/_layout.tsx` uses `expo-router`'s native tabs
 * rather than a bar this app paints. Handing `<NativeTabs backgroundColor>` a token here
 * would replace that material with an opaque fill and throw away exactly what was gained,
 * so this returns `undefined`: not "no opinion", but "the platform's opinion, deliberately."
 *
 * That is the same reasoning `confirmDestructive.ts` next door records for the delete
 * dialog — some chrome belongs to the OS, and the app's job is to stay out of its way. §0.1
 * is not broken by it either: a system material is not a hue the app spent on anything, and
 * the two things the app *does* colour here (the glyph and its label) still come from
 * tokens (`nativeTabsAppearance`, navigation/tabs.ts).
 *
 * The browser's half is `tabBarSurface.web.ts`, and it is the one that has to name a colour.
 *
 * `scheme` is taken on both halves even though this one ignores it, so the two keep one
 * signature and a caller never has to know which is loaded.
 */
export function tabBarSurface(_scheme: ColorScheme): ColorValue | undefined {
  return undefined;
}
