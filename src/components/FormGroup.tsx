import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

export interface FormGroupProps {
  title: string;
  scheme: ColorScheme;
  children: ReactNode;
  /** Collapsed by default (DESIGN.md §2.2: "the rest lives in collapsible groups") — a
   * caller could open one on mount, but nothing in this milestone needs to. */
  defaultExpanded?: boolean;
}

/**
 * One of §2.2's six collapsible groups — *Times & depth · Conditions · Gas & cylinders ·
 * Equipment · People · Notes & rating* — sitting below the form's always-visible core
 * strip. Owns its own disclosure state: each group opens and closes independently, so
 * DiveFormScreen does not have to hold an array of booleans just to render six of these.
 *
 * The header is a single `Pressable` at the §0.5 floor (`formGroupHeader`'s `minHeight:
 * 48`) — the brief's own "48 dp minimum tap targets, including each group's header."
 * Children are only ever mounted while `expanded`: `{expanded && ...}`, not a
 * zero-height/hidden wrapper around content that stays in the tree. A style-only hide
 * would still leave every collapsed field's label and value reachable by a plain text
 * search, which is exactly the assertion this component's own test warns against — "an
 * assertion that a group's header renders would pass whether or not its fields are
 * actually hidden."
 *
 * The disclosure state is a **chevron, drawn and rotated** (DESIGN.md §0.6: "A collapsible
 * group is marked by a chevron, not by the words 'Show'/'Hide'. **Drawn, not typed**... It
 * rotates to show state, needs no translation, and drops a word from a row that is
 * otherwise pure structure.")
 *
 * This header carried the words until now, on a finding that was correct and led to the
 * wrong conclusion: neither bundled font (Archivo, IBM Plex Mono) contains a chevron code
 * point, so a typed one renders as tofu or nothing, device-dependent — the same gap
 * `styles.ts` records for `reorderArrowUp`/`reorderArrowDown`. A word was one way out of
 * that; drawing the mark is the other, and §0.6 picks it for the reason it already gives
 * for rating marks. `formGroupChevron` (theme/styles.ts) is that drawing.
 *
 * **Dropping the visible word does not drop the announced one.** `accessibilityLabel` still
 * says which of the two things pressing this will do, in words, and
 * `accessibilityState.expanded` still carries the state as state — both unchanged, and both
 * are what a screen reader has always actually read here: "Show"/"Hide" was never part of
 * the announcement, so a diver using VoiceOver hears exactly what they heard before.
 */
export function FormGroup({ title, scheme, children, defaultExpanded = false }: FormGroupProps) {
  const styles = makeStyles(scheme);
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <View style={styles.formGroup}>
      <Pressable
        style={styles.formGroupHeader}
        onPress={() => setExpanded((current) => !current)}
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
        accessibilityState={{ expanded }}
      >
        <Text style={styles.formGroupTitle}>{title}</Text>
        {/* No `accessibilityLabel` and no role of its own: the whole 48 dp row is the
            control and already announces itself, and a mark that announced "chevron" beside
            it would have a screen reader read one button twice. */}
        <View style={[styles.formGroupChevron, expanded && styles.formGroupChevronExpanded]} />
      </Pressable>
      {expanded ? <View style={styles.formGroupBody}>{children}</View> : null}
    </View>
  );
}
