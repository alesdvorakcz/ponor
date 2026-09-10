import { processColor } from 'react-native';

/**
 * **The colour an SVG element was actually painted with.**
 *
 * react-native-svg does not keep the string it was handed: `extractBrush` runs every
 * `stroke`/`fill` through React Native's own `processColor` and passes the native element
 * `{ type: 0, payload: <ARGB int> }`. So an assertion has to compare payloads, and `paint`
 * below puts the expected colour through the same conversion — which makes a test compare one
 * colour with another rather than pin the encoding react-native-svg happens to use today.
 *
 * **Shared, and that is the whole-branch review's Minor #5.** `DepthProfile.test.tsx` and
 * `ProfileSparkline.test.tsx` each carried this pair, the second under a docblock calling
 * itself *"reused by the same approach rather than a second copy"* — which is the exact
 * sentence `suuntoFixture.ts`, beside this file, was written to answer: **that is what a second
 * copy is.** Finding the same phrase again, three files later, is what says the move is the fix
 * rather than a better comment.
 *
 * It is shared where `textIn` and `pathsIn` are not, and the line is `unexpectedGraphics.ts`'s:
 * a query helper is a way of asking a tree a question and stays local, while this encodes a
 * *fact about the library* — one that would otherwise have to be re-learned in two files at
 * once the day react-native-svg changes how it holds a brush.
 */
export function paintOf(node: { props: Record<string, unknown> }, prop: 'stroke' | 'fill'): unknown {
  return (node.props[prop] as { payload?: unknown } | undefined)?.payload;
}

/** The expected colour, converted the way the elements themselves were — see `paintOf`. */
export function paint(colour: string): unknown {
  return processColor(colour);
}
