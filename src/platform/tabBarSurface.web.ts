import type { ColorValue } from 'react-native';

import type { tabBarSurface as NativeTabBarSurface } from './tabBarSurface';
import { themeFor } from '../theme/resolve';
import { type ColorScheme } from '../theme/tokens';

/**
 * The browser's tab-bar ground. Web only; Metro picks this file over `tabBarSurface.ts` for
 * `--platform web`, and Jest's platforms are iOS-only, so nothing here reaches a device
 * build or a test run.
 *
 * It exists because the browser has no native tab bar to inherit a material from.
 * expo-router's web implementation draws the bar itself, in CSS
 * (`expo-router/assets/native-tabs.module.css`), and its ground is
 * `var(--expo-router-tabs-background-color, #272727)` — a hard-coded dark grey that knows
 * nothing about which scheme the app is in, and which is plainly wrong on the light theme
 * §0.5 calls a functional requirement rather than a taste question. The variable is set from
 * this value, so returning a token is what makes the browser's bar follow the app.
 *
 * `surface` rather than `bg`: the web bar is a floating pill over the content (that CSS
 * positions it `fixed`, not docked), so it is the same kind of object as the search capsule
 * and takes the token §0.2 reserves for one — an element resting *on* the ground, not the
 * ground itself.
 */
export function tabBarSurface(scheme: ColorScheme): ColorValue | undefined {
  return themeFor(scheme).surface;
}

type Assert<T extends true> = T;

/**
 * Compile-time proof the two halves stay one function. Metro chooses between them by
 * filename and nothing at runtime checks that they agree, so this asserts it where `tsc`
 * can see it — the same guard `confirmDestructive.web.ts` and `DateTimeField.web.tsx` use,
 * and for the same reason.
 *
 * The import above is `import type`, so Babel erases it: TypeScript reads
 * `./tabBarSurface` as the native file (it does not apply Metro's platform extensions),
 * while the web bundle never resolves the specifier and cannot import itself.
 */
export type WebTabBarSurfaceMatchesNative = Assert<
  typeof tabBarSurface extends typeof NativeTabBarSurface ? true : false
>;
