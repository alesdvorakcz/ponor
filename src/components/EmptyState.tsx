import { Pressable, Text, View } from 'react-native';

import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

interface EmptyStateProps {
  scheme: ColorScheme;
  onPress: () => void;
}

/**
 * Shown only when the logbook genuinely has no dives (`useDives()` returned
 * an empty list with no error) — never for a search that matched nothing,
 * and never for a failed read. Those three read the same to a diver unless
 * DivesScreen.tsx tells them apart, and this component is only ever the
 * first of them: a failed read is a lie this component would tell if it
 * were reused for that case, which is why DivesScreen.tsx checks `error`
 * before it ever gets here (see its own comment).
 *
 * The primary action sits in the bottom third of the screen (DESIGN.md
 * §0.5: wet hands, one thumb) and is styled from the `action`/`action-fg`
 * tokens — the app's one button treatment (§0.1: colour is depth and
 * nothing else, so every control, including this one, is monochrome).
 *
 * Review task 7, Important #4: this is the entire first-run experience, so its `Pressable`
 * carries `accessibilityRole="button"` rather than relying on the default — `Pressable`
 * does not supply one on its own. No separate `accessibilityLabel`: unlike `DiveRow`'s
 * fragmented number/site/depth, this button's own visible text already says exactly what
 * it does.
 */
export function EmptyState({ scheme, onPress }: EmptyStateProps) {
  const styles = makeStyles(scheme);
  return (
    <View style={styles.emptyStateWrap}>
      <Text style={styles.emptyStateText}>Your logbook is empty.</Text>
      <Pressable style={styles.action} onPress={onPress} accessibilityRole="button">
        <Text style={styles.actionLabel}>Log your first dive</Text>
      </Pressable>
    </View>
  );
}
