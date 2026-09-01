import { render, type RenderResult } from '@testing-library/react-native';

import { formatDepthBandRange } from '../format/display';
import { UNIT_SYSTEMS } from '../format/units';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { depthBandRanges } from '../theme/depth';
import { makeStyles } from '../theme/styles';
import { depthScale } from '../theme/tokens';
import { DepthLegend } from './DepthLegend';

// The same RTL adaptation every component test in this file's neighbours notes: `render` is
// async, and `root.queryAll` walks HOST elements only and never returns the instance it is
// called on — so the subject's own root is included explicitly, exactly as
// `unexpectedGraphics.ts` records finding in five copies of its own guard.
function nodesIn(t: RenderResult) {
  return t.root ? [t.root, ...t.root.queryAll(() => true)] : [];
}

function textIn(t: RenderResult): string[] {
  return nodesIn(t)
    .filter((n) => n.type === 'Text')
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

/** Every swatch's fill, in tree order — the bars are the only thing on this screen that
 * carries a background colour composed in at a call site. */
function barColoursIn(t: RenderResult, scheme: 'dark' | 'light'): unknown[] {
  const bar = makeStyles(scheme).depthLegendBar as unknown;
  return nodesIn(t)
    .filter((n) => n.type === 'View' && [n.props?.style].flat(5).includes(bar))
    .map((n) =>
      ([n.props?.style].flat(5).filter(Boolean) as Record<string, unknown>[]).reduce<unknown>(
        // LAST wins, the order React Native resolves a style array in — so a colour in the
        // sheet could never be mistaken for the one the call site composed over it.
        (acc, s) => (s.backgroundColor !== undefined ? s.backgroundColor : acc),
        undefined,
      ),
    );
}

// **The one place in Ponor where a depth colour appears without a dive under it** (DESIGN.md
// §0.6's first-run screen, M1h). Everything below asks whether the legend is still derived
// from the scale, because the failure this component can have is not "it looks wrong" — it is
// a legend that confidently teaches boundaries the logbook does not use, drawn in the right
// colours, which is exactly what would stop anyone noticing.

it('draws one bar per band, in the scale order and in the scheme it was given', async () => {
  for (const scheme of ['dark', 'light'] as const) {
    const t = await render(<DepthLegend scheme={scheme} system="metric" />);
    // Compared against `tokens.js` itself, not against a list of six hex strings: a copy here
    // would agree with a palette edit that never reached the app.
    expect(barColoursIn(t, scheme)).toEqual([...depthScale[scheme]]);
  }
});

it('does not paint a light legend out of the dark palette, or the other way round', async () => {
  // The scheme is a prop, and a component that ignored it would still draw six correct-looking
  // bars — which is why this asks for the *other* scheme's swatches and requires none of them.
  const t = await render(<DepthLegend scheme="light" system="metric" />);
  const drawn = barColoursIn(t, 'light');
  expect(drawn.some((colour) => (depthScale.dark as readonly string[]).includes(colour as string))).toBe(false);
});

// **The labels are derived, or they are a second copy of the scale.** Asserted against
// `depthBandRanges` run through `formatDepthBandRange` rather than against six strings,
// because six strings is precisely the defect: they would keep passing after a boundary moved.
it('labels every band from the scale that colours it, in either unit system', async () => {
  for (const system of UNIT_SYSTEMS) {
    const t = await render(<DepthLegend scheme="dark" system={system} />);
    expect(textIn(t)).toEqual(
      depthBandRanges.map((range) => formatDepthBandRange(range.fromM, range.toM, system)),
    );
  }
});

// ...and one place that does state the strings, once, because the derivation above cannot
// catch a mistake made inside the two owners it derives from. §10 settled that depth takes
// whole feet, so the imperial boundaries land ragged — 6 m is 19.685 ft — and ragged is the
// honest answer: a first-run screen that quietly rounded to tidy numbers, or worse switched
// the diver back to metres to get them, would be teaching on a lie.
it('reads the boundaries in the diver own units, ragged imperial figures and all', async () => {
  const metric = await render(<DepthLegend scheme="dark" system="metric" />);
  expect(textIn(metric)).toEqual(['0–6', '6–12', '12–20', '20–30', '30–40', '40+ m']);

  const imperial = await render(<DepthLegend scheme="dark" system="imperial" />);
  expect(textIn(imperial)).toEqual(['0–20', '20–39', '39–66', '66–98', '98–131', '131+ ft']);
});

// The §0.4/§0.1 guard, on the one component in the app that is *allowed* a hue outside the
// sheet. It passes because a band colour comes from `theme/depth.ts`, the only reader of the
// scale (§4.1) — and `unexpectedGraphics` was extended in M1h to say exactly that and nothing
// broader, so a `{ backgroundColor: '#ff0000' }` here would still be reported.
it('paints nothing the depth scale did not produce, in either scheme', async () => {
  for (const scheme of ['dark', 'light'] as const) {
    const t = await render(<DepthLegend scheme={scheme} system="metric" />);
    expect(unexpectedGraphics(t, scheme)).toEqual([]);
  }
});
