import { type ReactNode } from 'react';
import { type ColorValue } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import {
  CONDITION_SCALE_VALUES,
  CONFIGURATION_VALUES,
  ENTRY_VALUES,
  SITE_TYPE_VALUES,
  SUIT_VALUES,
  VISIBILITY_VALUES,
  WATER_BODY_VALUES,
  WEATHER_VALUES,
} from '../domain/types';
import { CONDITION_ICONS, type ConditionIconName, type IconElement } from './icons/conditionIconData';

export type { ConditionIconName } from './icons/conditionIconData';

/** The main stroke and the finer one, in the 40-unit grid's own units (DESIGN.md §0.6). */
const LINE_WIDTH = 2;
const DETAIL_WIDTH = 1.35;

/** A dash pattern divided by the scale it is drawn at, so the dashes keep their length too. */
function scaledDash(dash: string | undefined, scale: number): string | undefined {
  if (dash === undefined) return undefined;
  return dash
    .split(/\s+/)
    .map((part) => String(Number(part) / scale))
    .join(' ');
}

function draw(elements: IconElement[], ink: ColorValue, ground: ColorValue, scale: number): ReactNode[] {
  return elements.map((element, index) => {
    switch (element.role) {
      case 'line':
      case 'detail':
        return (
          <Path
            key={index}
            d={element.d}
            fill="none"
            stroke={ink}
            strokeWidth={(element.role === 'line' ? LINE_WIDTH : DETAIL_WIDTH) / scale}
            strokeDasharray={scaledDash(element.dash, scale)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case 'knock':
        return <Path key={index} d={element.d} fill={ground} />;
      case 'dot':
        return <Circle key={index} cx={element.cx} cy={element.cy} r={element.r} fill={ink} />;
      case 'group':
        return (
          <G key={index} transform={element.transform}>
            {draw(element.children, ink, ground, scale * element.scale)}
          </G>
        );
    }
  });
}

export interface ConditionIconProps {
  name: ConditionIconName;
  /** The ink of the label beside it, handed in by whoever knows whether the tile is chosen (§0.6). */
  ink: ColorValue;
  /**
   * The colour the icon sits on. A knock is filled with it so lines behind a shape disappear, which
   * is why a chosen (inverted) tile has to pass its own ground here, not the screen's.
   */
  ground: ColorValue;
  /** Points on screen; the drawing is always the 40-unit grid scaled to it. */
  size?: number;
}

/**
 * One of Ponor's own drawn icons (issue #6): the data in `icons/conditionIconData.ts`, painted by
 * role. **This is the only place stroke widths, caps and knocks are decided**, so a drawing can never
 * come out in a different hand from its neighbours.
 *
 * Decorative to a screen reader by construction: §0.6 makes an icon a supplement to its label, so
 * whatever draws it also draws the word, and the word is what is announced.
 */
export function ConditionIcon({ name, ink, ground, size = 40 }: ConditionIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {draw(CONDITION_ICONS[name], ink, ground, 1)}
    </Svg>
  );
}

export type IconField = 'entry' | 'waterBody' | 'weather' | 'waves' | 'visibility' | 'current' | 'surge' | 'configuration' | 'suit' | 'siteType';

/**
 * **Which values have a drawing, and which one** (DESIGN.md §0.6's table).
 *
 * `null` is an answer, not a gap: entry *other* and suit *none* are words by design (no shape to
 * draw), and a token this build does not know (a newer client's value, §10's store-and-flag) or a
 * scale level out of range has no drawing either. Every caller shows the word whatever this says.
 *
 * Visibility, current and surge have **one icon for the field**, the level in words, with the dashed
 * *None* for current and surge: the departure §10 records.
 */
export function conditionIconFor(field: IconField, value: string | number | null | undefined): ConditionIconName | null {
  if (value === null || value === undefined) return null;
  const is = (values: readonly (string | number)[]) => values.includes(value);
  switch (field) {
    case 'entry':
      return is(ENTRY_VALUES) && value !== 'other' ? (`entry.${value}` as ConditionIconName) : null;
    case 'suit':
      return is(SUIT_VALUES) && value !== 'none' ? (`suit.${value}` as ConditionIconName) : null;
    case 'waterBody':
      return is(WATER_BODY_VALUES) ? (`waterBody.${value}` as ConditionIconName) : null;
    case 'weather':
      return is(WEATHER_VALUES) ? (`weather.${value}` as ConditionIconName) : null;
    case 'configuration':
      return is(CONFIGURATION_VALUES) ? (`configuration.${value}` as ConditionIconName) : null;
    case 'siteType':
      return is(SITE_TYPE_VALUES) ? (`siteType.${value}` as ConditionIconName) : null;
    case 'waves':
      return is(CONDITION_SCALE_VALUES) ? (`waves.${value}` as ConditionIconName) : null;
    case 'visibility':
      return is(VISIBILITY_VALUES) ? 'visibility' : null;
    case 'current':
    case 'surge':
      if (!is(CONDITION_SCALE_VALUES)) return null;
      return value === 0 ? `${field}.none` : field;
  }
}
