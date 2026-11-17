import { render, type RenderResult } from '@testing-library/react-native';

import { makeStyles } from '../theme/styles';
import { ConditionTiles, type ConditionTile } from './ConditionTiles';

type TestNode = NonNullable<RenderResult['root']>;

/** The words in a node, nested texts included, in reading order. */
function textIn(node: TestNode | null | undefined): string[] {
  return (node ? node.queryAll((n) => n.type === 'Text') : [])
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

function tilesOf(t: RenderResult) {
  const styles = makeStyles('dark');
  return t.root ? t.root.queryAll((n) => n.type === 'View' && [n.props.style].flat(3).includes(styles.conditionTile)) : [];
}

const TILES: ConditionTile[] = [
  { key: 'entry', icon: 'entry.boat', value: 'Boat', label: 'Entry' },
  { key: 'surge', icon: 'surge.none', value: 'None', label: 'Surge' },
  { key: 'suit', icon: 'suit.wet', value: 'Wet', label: 'Suit', extra: '5 mm' },
  { key: 'waves', icon: null, value: '7', label: 'Waves' },
];

it('draws one tile per condition, three to a row, each its icon, its value and its field', async () => {
  const styles = makeStyles('dark');
  const t = await render(<ConditionTiles tiles={TILES} scheme="dark" />);
  const tiles = tilesOf(t);
  expect(tiles).toHaveLength(4);
  const rows = t.root!.queryAll((n) => n.type === 'View' && [n.props.style].flat(3).includes(styles.conditionTileRow));
  // Two rows of three slots: the second holds one tile and two spacers, so the tile stays a third wide.
  expect(rows).toHaveLength(2);
  expect(textIn(tiles[0])).toEqual(['Boat', 'Entry']);
  expect(tiles[0]!.queryAll((n) => n.type === 'RNSVGSvgView')).toHaveLength(1);
});

it('follows the value with its extra, after a middot', async () => {
  const t = await render(<ConditionTiles tiles={TILES} scheme="dark" />);
  expect(textIn(tilesOf(t)[2])).toEqual(['Wet', ' · 5 mm', 'Suit']);
});

it('keeps the icon’s room for a value with no drawing, and draws nothing in it', async () => {
  const styles = makeStyles('dark');
  const t = await render(<ConditionTiles tiles={TILES} scheme="dark" />);
  const waves = tilesOf(t)[3]!;
  expect(waves.queryAll((n) => n.type === 'RNSVGSvgView')).toHaveLength(0);
  expect(waves.queryAll((n) => n.type === 'View' && [n.props.style].flat(3).includes(styles.conditionTileIconSpace))).toHaveLength(1);
  expect(textIn(waves)).toEqual(['7', 'Waves']);
});

// Final review, Important #2: the field's name wraps rather than truncates (§0.5) — Czech
// *Vodní plocha* in mono caps fills a tile's width at the default size and overflows above it.
it('lets the field name wrap instead of truncating it', async () => {
  const t = await render(<ConditionTiles tiles={TILES} scheme="dark" />);
  const styles = makeStyles('dark');
  const names = t.root!.queryAll((n) => n.type === 'Text' && [n.props.style].flat(3).includes(styles.conditionTileLabel));
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) expect(name.props.numberOfLines).toBeUndefined();
});

// Final review, Important #3: each tile is ONE thing to a screen reader, its field and its value,
// as the row it replaced was — not two elements a VoiceOver sweep would read out of order.
it('announces each tile as its field and its value, as one element', async () => {
  const t = await render(<ConditionTiles tiles={TILES} scheme="dark" />);
  const tiles = tilesOf(t);
  expect(tiles.map((tile) => [tile.props.accessible, tile.props.accessibilityLabel])).toEqual([
    [true, 'Entry: Boat'],
    [true, 'Surge: None'],
    [true, 'Suit: Wet · 5 mm'],
    [true, 'Waves: 7'],
  ]);
});

it('draws nothing at all for no conditions', async () => {
  const t = await render(<ConditionTiles tiles={[]} scheme="dark" />);
  expect(t.toJSON()).toBeNull();
});
