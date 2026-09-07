import { forwardRef, useImperativeHandle } from 'react';
import { Text, View } from 'react-native';

import { t } from '../i18n';
import { makeStyles } from '../theme/styles';
import type { DiveMap as NativeDiveMap, DiveMapHandle, DiveMapProps } from './DiveMap';

/**
 * **The browser's half of the map, and it is a sentence rather than a map** — DESIGN.md §9,
 * already recorded before this task began: *"`react-native-maps` has no web support, so M2's
 * Map tab will not render there."*
 *
 * **This file exists because "no web support" understates it.** The package does ship a web
 * shim and it covers exactly one export: `MapView.web.ts` re-exports `react-native-web`'s
 * `UnimplementedView` as the default. Everything else in `index.ts` is unshimmed, and two of
 * those modules run native codegen **at module scope** — `MapMarkerNativeComponent.ts` calls
 * `codegenNativeCommands({supportedCommands: […]})` as a top-level `const`, and every
 * `specs/NativeComponent*.ts` calls `codegenNativeComponent`. `react-native-web` exports
 * neither function (read off its own `dist/index.js` export list, not assumed), so the
 * specifier resolves to `undefined` and calling it throws while the module is still being
 * evaluated. That is not a component that renders nothing; it is the tab taking the app down
 * the moment it is opened.
 *
 * So the split is at the SURFACE rather than at the screen. `MapScreen` is one file for both
 * platforms — it owns the grouping, the layers, the empty states and the site sheet, none of
 * which is native — and Metro resolves `./DiveMap` to this module in a web bundle, exactly as
 * it resolves `DateTimeField` and `db/client` for the same class of gap. The browser therefore
 * keeps everything about this screen that is not the cartography: the title, which layer is
 * showing, how many places are on it, and a line saying where the map itself lives.
 *
 * §9 puts web at *"a testing target, not a supported platform — no store listing, no parity
 * promise"*, which is what makes a sentence the right answer rather than a second map. Adding
 * one would mean a second mapping library, a second marker vocabulary and a second set of §0.1
 * decisions, for a platform that exists so the design can be reviewed quickly.
 *
 * `marks` is the one prop this reads, because how many places *would* have been drawn is the
 * only thing this message can honestly add — a browser reviewing the screen should be able to
 * see that the grouping ran and what it produced.
 *
 * **The camera is therefore inert here, and inert is the honest answer** (M3l): a refit moves a
 * camera, this file has no camera, and there is no region for one to settle at. `MapScreen` is one
 * file for both platforms and asks the same questions either way — but because `onRegionSettled`
 * never fires, the screen never learns of a camera to move, `refitRegion` answers null on every
 * switch, and `moveTo` is never called. The no-op below is what the parity assertion needs rather
 * than a branch anything reaches.
 */
export const DiveMap = forwardRef<DiveMapHandle, DiveMapProps>(function DiveMap({ scheme, marks }, handle) {
  const styles = makeStyles(scheme);
  useImperativeHandle(handle, () => ({ moveTo: () => {} }), []);
  return (
    <View style={styles.centerFill}>
      <Text style={styles.messageText}>{t('map.webUnavailable')}</Text>
      {/* The count declines, and in Czech so does the verb with it — *bylo připnuto* against
          *byla připnuta* — so i18next picks the form rather than a ternary on `=== 1`. */}
      <Text style={styles.messageText}>{t('map.webPlaces', { count: marks.length })}</Text>
    </View>
  );
});

type Assert<T extends true> = T;

/**
 * **Compile-time proof that the browser's map takes everything the device's map takes.**
 *
 * The same assertion `DateTimeField.web.tsx` carries, for the same reason and with the same
 * exact limits. A caller imports `./DiveMap`, gets whichever file its platform resolves, and
 * must not be able to tell which — so this file growing a narrower contract of its own (its own
 * props interface, a prop it declines to accept) is a `tsc` failure rather than a screen that
 * compiles on one platform and not the other.
 *
 * **What it does not catch:** a prop *added* to `DiveMap.tsx`. Both files read the same
 * `DiveMapProps`, so a new prop type-checks in both and this file simply ignores it. There is no
 * type that would catch that, and saying so is better than implying otherwise.
 *
 * The import above is `import type`, which Babel erases: TypeScript reads `./DiveMap` as the
 * native file — it does not apply Metro's platform extensions — while the web bundle never
 * resolves the specifier at all and so cannot import itself.
 */
export type WebDiveMapMatchesNative = Assert<
  typeof DiveMap extends typeof NativeDiveMap ? true : false
>;
