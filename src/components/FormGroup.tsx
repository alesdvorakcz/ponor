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
 * The disclosure state itself is shown as text ("Show"/"Hide"), the same choice
 * `DayStrip.tsx` already made for its own "Reorder"/"Done" control rather than a chevron
 * glyph: `styles.ts`'s own history (`reorderArrowUp`/`reorderArrowDown`) records that
 * neither bundled font (Archivo, IBM Plex Mono) contains a triangle or chevron code
 * point, so a typed arrow glyph renders as tofu or nothing, device-dependent. Text needs
 * no glyph coverage this app hasn't already verified.
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
        <Text style={styles.formGroupState}>{expanded ? 'Hide' : 'Show'}</Text>
      </Pressable>
      {expanded ? <View style={styles.formGroupBody}>{children}</View> : null}
    </View>
  );
}
