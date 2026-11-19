import { SymbolView } from 'expo-symbols';
import { Pressable, Text, View } from 'react-native';

import { t } from '../i18n';
import { themeFor } from '../theme/resolve';
import { type Styles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { symbolName, type PlatformSymbol } from './symbolName';

/**
 * The card's map glyph. Exported for `symbolName.test.tsx`, whose census holds every symbol the app
 * ships to a pin by the very object the app draws (#49).
 */
export const SHOW_ON_MAP_GLYPH: PlatformSymbol = { ios: 'map', android: 'map' };

/**
 * **"Show on map"** — a place's position as a card: the map glyph, the words, and the coordinates
 * muted under them (the design canvas's card, issue #3).
 *
 * **One component on three pages since issue #21**: the dive detail, a site's page and a centre's
 * page, which is where the canvas draws it too. It was the dive detail's own function until a
 * second page wanted it, which is the point at which a shape becomes a rule (§4.1).
 *
 * The card does not decide where it goes — each page hands it `onPress` (`platform/showOnMap.ts`
 * for Ponor's map, `platform/mapsLink.ts` for a planned dive with no site, which has no mark on it), because the
 * destination depends on what the place is and the card only knows that it has a position.
 *
 * A page draws it only for a position `pointOf` accepts (domain/mapSites.ts) — the Map's own test
 * of whether a pair is a place at all — so the card never offers to show a point no map can draw.
 */
export function MapCard({
  styles,
  scheme,
  coordinates,
  onPress,
}: {
  styles: Styles;
  scheme: ColorScheme;
  /** The two numbers under the words, already formatted (`formatCoordinates`). */
  coordinates: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.detailMapCard}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('detail.showOnMap')}
      accessibilityHint={coordinates}
    >
      <SymbolView name={symbolName(SHOW_ON_MAP_GLYPH)} size={22} tintColor={themeFor(scheme).fg} />
      <View style={styles.detailMapCardText}>
        <Text style={styles.detailMapCardTitle}>{t('detail.showOnMap')}</Text>
        <Text style={styles.detailMapCardMeta}>{coordinates}</Text>
      </View>
    </Pressable>
  );
}
