import { render, type RenderResult } from '@testing-library/react-native';

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
import { paint, paintOf } from '../testing/svgPaint';
import { makeStyles } from '../theme/styles';
import { ConditionIcon, conditionIconFor, DepthGlyph, type IconField } from './ConditionIcon';
import { CONDITION_ICONS } from './icons/conditionIconData';

// react-native-svg's elements reach the test tree under their native names (see
// DepthProfile.test.tsx): a `Path` is an `RNSVGPath`, a `G` an `RNSVGGroup`.
function nodes(t: RenderResult, type: string) {
  return t.root ? t.root.queryAll((n) => n.type === type) : [];
}

const INK = '#F0F5F8';
const GROUND = '#111820';

it.each([
  ['entry', 'shore', 'entry.shore'],
  ['entry', 'other', null],
  ['suit', 'wet', 'suit.wet'],
  ['suit', 'none', null],
  ['waves', 0, 'waves.0'],
  ['waves', 3, 'waves.3'],
  ['waves', 7, null],
  ['visibility', 'low', 'visibility'],
  ['current', 0, 'current.none'],
  ['current', 2, 'current'],
  ['surge', 0, 'surge.none'],
  ['surge', 3, 'surge'],
  ['siteType', 'swim_through', 'siteType.swim_through'],
  ['siteType', 'cavern', null],
  ['waterBody', null, null],
])('conditionIconFor(%s, %p) is %p', (field, value, name) => {
  expect(conditionIconFor(field as IconField, value)).toBe(name);
});

// The words-only values are a deliberate absence (§0.6: an icon only where the value has a shape),
// so this checks both directions: every other value has a drawing, and those two have none.
it('has a drawing for every value of every icon vocabulary except the words-only ones', () => {
  const vocabularies: [IconField, readonly (string | number)[]][] = [
    ['entry', ENTRY_VALUES],
    ['waterBody', WATER_BODY_VALUES],
    ['weather', WEATHER_VALUES],
    ['waves', CONDITION_SCALE_VALUES],
    ['visibility', VISIBILITY_VALUES],
    ['current', CONDITION_SCALE_VALUES],
    ['surge', CONDITION_SCALE_VALUES],
    ['configuration', CONFIGURATION_VALUES],
    ['suit', SUIT_VALUES],
    ['siteType', SITE_TYPE_VALUES],
  ];
  const wordsOnly = new Set(['entry:other', 'suit:none']);
  for (const [field, values] of vocabularies) {
    for (const value of values) {
      const name = conditionIconFor(field, value);
      if (wordsOnly.has(`${field}:${value}`)) {
        expect(name).toBeNull();
      } else {
        expect(name).not.toBeNull();
        expect(CONDITION_ICONS[name!].length).toBeGreaterThan(0);
      }
    }
  }
});

it('strokes a line at 2 and a detail at 1.35, in the ink', async () => {
  const t = await render(<ConditionIcon name="entry.shore" ink={INK} ground={GROUND} />);
  const stroked = nodes(t, 'RNSVGPath').filter((p) => paintOf(p, 'stroke') !== undefined);
  const widths = new Set(stroked.map((p) => Number(p.props.strokeWidth)));
  expect(widths).toEqual(new Set([2, 1.35]));
  for (const p of stroked) expect(paintOf(p, 'stroke')).toEqual(paint(INK));
});

it('fills a knock with the ground, never the ink', async () => {
  const t = await render(<ConditionIcon name="entry.boat" ink={INK} ground={GROUND} />);
  const filled = nodes(t, 'RNSVGPath').filter((p) => paintOf(p, 'fill') !== undefined && paintOf(p, 'stroke') === undefined);
  expect(filled.length).toBeGreaterThan(0);
  for (const p of filled) expect(paintOf(p, 'fill')).toEqual(paint(GROUND));
});

it("keeps a scaled group's strokes at full width", async () => {
  const t = await render(<ConditionIcon name="siteType.wall" ink={INK} ground={GROUND} />);
  const widths = nodes(t, 'RNSVGPath').map((p) => Number(p.props.strokeWidth)).filter((w) => w > 0);
  // The wall's diver is drawn at 0.62 of its size: a 2.0 line inside that group has to be stroked
  // at 2 / 0.62 to come out 2 wide, and a 1.35 detail at 1.35 / 0.62.
  expect(widths.some((w) => Math.abs(w - 2 / 0.62) < 0.01)).toBe(true);
  expect(widths.some((w) => Math.abs(w - 1.35 / 0.62) < 0.01)).toBe(true);
});

it('draws the dashed None for current with the line dashed', async () => {
  const t = await render(<ConditionIcon name="current.none" ink={INK} ground={GROUND} />);
  const paths = nodes(t, 'RNSVGPath');
  expect(paths.length).toBe(3);
  for (const p of paths) expect(p.props.strokeDasharray).toBeTruthy();
  const solid = await render(<ConditionIcon name="current" ink={INK} ground={GROUND} />);
  for (const p of nodes(solid, 'RNSVGPath')) expect(p.props.strokeDasharray).toBeFalsy();
});

// PR #66 review, finding 7: the two depth rows on the form and the detail wired this glyph by hand
// four times. `DepthGlyph` is its one owner — the size a style (`figureGlyph`), the ink the rows'
// label ink, the ground the screen's.
it.each([
  ['max', 'figure.maxDepth'],
  ['avg', 'figure.avgDepth'],
] as const)('draws the %s depth glyph at the figure size, in the label ink on the screen ground', async (depth, name) => {
  const styles = makeStyles('dark');
  const glyph = await render(<DepthGlyph depth={depth} scheme="dark" />);
  expect(glyph.root!.props.width).toBe(24);
  expect(glyph.root!.props.width).toBe(styles.figureGlyph.width);
  for (const p of nodes(glyph, 'RNSVGPath').filter((path) => paintOf(path, 'stroke') !== undefined)) {
    expect(paintOf(p, 'stroke')).toEqual(paint(styles.detailLabel.color as string));
    expect(paintOf(p, 'stroke')).toEqual(paint(styles.formFieldLabel.color as string));
  }
  const byHand = await render(
    <ConditionIcon name={name} ink={styles.figureGlyph.color as string} ground={styles.screen.backgroundColor as string} size={24} />,
  );
  expect(glyph.toJSON()).toEqual(byHand.toJSON());
});

it('renders at the requested size on the 40-unit grid', async () => {
  const t = await render(<ConditionIcon name="weather.sunny" ink={INK} ground={GROUND} size={24} />);
  // The svg is the rendered tree's root, which `queryAll` does not include.
  const svg = t.root!;
  expect(svg.type).toBe('RNSVGSvgView');
  expect(svg.props.width).toBe(24);
  expect(svg.props.height).toBe(24);
  expect(svg.props.vbWidth).toBe(40);
  expect(svg.props.vbHeight).toBe(40);
});
