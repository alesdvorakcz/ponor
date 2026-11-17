import { Text, View, type ColorValue } from 'react-native';

import { t } from '../i18n';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { ConditionIcon, type ConditionIconName } from './ConditionIcon';
import { tileRows } from './tileRows';

/**
 * One condition as the dive detail shows it (issue #6): its drawing, the value, and the field it
 * belongs to. `icon` is `null` for a value with no drawing (entry *other*, suit *none*, a level out
 * of range, a token this build does not know): the tile keeps the icon's room and draws nothing in
 * it, so a row of tiles stays aligned and the word still says what was recorded.
 */
export interface ConditionTile {
  key: string;
  icon: ConditionIconName | null;
  value: string;
  label: string;
  /** Follows the value after a middot, in muted mono: the suit's thickness (*Wet · 5 mm*). */
  extra?: string;
}

/**
 * The conditions as a grid of tiles, three to a row (the canvas's whole *Dive detail*, 2026-11-17).
 * Read-only, so no tile is a control and none is announced as one: a screen reader hears each
 * tile's words, the value and then the field. Draws nothing at all for no tiles, so a dive without
 * conditions has no empty grid (§1: a sparse dive is normal).
 */
export function ConditionTiles({ tiles, scheme }: { tiles: ConditionTile[]; scheme: ColorScheme }) {
  const styles = makeStyles(scheme);
  if (tiles.length === 0) return null;
  const ink = styles.conditionTileValue.color as ColorValue;
  const ground = styles.conditionTile.backgroundColor as ColorValue;
  return (
    <View style={styles.conditionTileGrid}>
      {tileRows(tiles, 3).map((row, index) => (
        <View key={index} style={styles.conditionTileRow}>
          {row.map((tile, slot) =>
            tile === null ? (
              <View key={`spacer-${slot}`} style={styles.conditionTileSpacer} />
            ) : (
              // One element to a screen reader, its field and its value, as the row it replaced was:
              // left ungrouped, VoiceOver reads a row's three values before their three fields.
              <View
                key={tile.key}
                style={styles.conditionTile}
                accessible
                accessibilityLabel={t('field.labelValue', {
                  label: tile.label,
                  value: tile.extra !== undefined ? `${tile.value} · ${tile.extra}` : tile.value,
                })}
              >
                {tile.icon !== null ? (
                  <ConditionIcon name={tile.icon} ink={ink} ground={ground} />
                ) : (
                  <View style={styles.conditionTileIconSpace} />
                )}
                <View style={styles.conditionTileWords}>
                  <Text style={styles.conditionTileValue}>
                    {tile.value}
                    {tile.extra !== undefined && <Text style={styles.conditionTileExtra}>{` · ${tile.extra}`}</Text>}
                  </Text>
                  {/* Wraps rather than truncates (§0.5): Czech field names in mono caps fill the tile. */}
                  <Text style={styles.conditionTileLabel}>{tile.label}</Text>
                </View>
              </View>
            ),
          )}
        </View>
      ))}
    </View>
  );
}
