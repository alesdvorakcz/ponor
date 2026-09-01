import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { tokens, depthScale } = require('../src/theme/tokens.js');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const svgTemplate = fs.readFileSync(path.join(root, 'assets', 'mark.svg'), 'utf8');

// mark.svg's gradient stops are {{depth-N}} placeholders standing in for
// depthScale.dark[N - 1] (N = 1-based band number, matching the band
// numbering documented in tokens.js), so tokens.js stays the one source of
// colour. Fail loudly on a bad placeholder rather than let "{{...}}" reach
// an icon as a literal, silently-broken paint value.
const svgText = svgTemplate.replace(/\{\{depth-(\d+)\}\}/g, (placeholder, band) => {
  const value = depthScale.dark[Number(band) - 1];
  if (value === undefined) {
    throw new Error(`${placeholder} in assets/mark.svg has no matching depthScale.dark token`);
  }
  return value;
});
const stray = svgText.match(/\{\{[^}]*\}\}/);
if (stray) {
  throw new Error(`assets/mark.svg has an unresolved placeholder: ${stray[0]}`);
}
const svg = Buffer.from(svgText);

/**
 * **The same drawing with all of its paint replaced by one colour, on a
 * transparent ground** — the asset `EmptyState` draws at 120 pt on the
 * first-run screen, and the one graphic the app renders anywhere.
 *
 * It exists because of DESIGN.md §0.1, not because of a file-size budget.
 * §0.3 strokes the mark in the depth gradient *on the app icon*, where the
 * mark is the only thing on screen; drawn inside the interface that same
 * gradient would be colour used as **brand**, and §0.1 says colour encodes
 * depth and nothing else. The empty state is the one screen whose entire job
 * is teaching that rule, so a gradient mark there would contradict the legend
 * six lines below it.
 *
 * **Why the PNG is monochrome rather than merely tinted at runtime.**
 * `emptyStateMark`'s `tintColor` (theme/styles.ts) repaints every opaque pixel
 * in the theme's ink, and on iOS, Android and react-native-web alike a tint
 * uses only the image's alpha — so the gradient asset would *look* right in
 * every place we could check. The failure mode is what makes that unacceptable:
 * anywhere a tint silently does not apply, the fallback would be the gradient
 * itself, i.e. §0.1 broken in exactly the screen that exists to teach it. With
 * a single-colour source the worst case is a mark in the wrong shade of ink.
 *
 * **How it is made single-colour without retyping a colour.** Every `stroke`
 * and `fill` that is not `none` is rewritten to `MONO`, and the `<defs>` block
 * — the depth gradient, now referenced by nothing — is dropped whole. So the
 * wave's `#5A6C78`, which mark.svg documents as a brand-asset colour that must
 * NOT be tokenised, is never named a second time here; it is simply one more
 * stroke. The check below then requires that nothing but `MONO` survives,
 * which is what turns "I think that regex caught everything" into a build
 * failure: give the mark a `fill="#123456"` tomorrow and the icons stop
 * building rather than shipping a two-colour mark into the interface.
 *
 * Comments go with the `<defs>`, and that is the check working rather than
 * being worked around: mark.svg's own comments *name* `#5A6C78` in prose (they
 * are what tells the next reader not to tokenise it), so the first run of this
 * refused to build over a colour in a sentence. Stripping them makes the file
 * that is scanned the file that is rendered — the alternative, exempting
 * comments from the scan, would exempt the one place a real colour is easiest
 * to leave behind by accident.
 *
 * **The wave keeps its subordination, in alpha rather than in hue** — and this
 * was found by looking at the first version on the simulator, not reasoned
 * about. §0.3 puts the wave behind the profile deliberately: "chosen to sit
 * quietly behind the profile". On the icon, *colour* is what does that — a flat
 * grey wave against a saturated gradient descent. Flatten both to one ink at
 * one width and the two strokes stop being two objects: the wave's ends curve
 * down into the profile's start and the whole thing reads as a longhorn skull,
 * which is not a joke — it is what the 120 pt render actually looked like.
 *
 * Alpha restores the hierarchy without restoring a second colour, which is
 * exactly the distinction §0.1 draws: transparency is not a hue, the asset is
 * still one ink, and `tintColor` (which repaints RGB and preserves alpha) keeps
 * the relationship in either theme.
 *
 * **Which stroke is the wave is read from the structure, never from its
 * colour.** The profile is the path stroked in the depth gradient — that is
 * what §0.3 says the mark *is* — so everything else is the water it hangs
 * under. Keying on `url(#depth)` therefore asks the question the file already
 * answers, where keying on `#5A6C78` would be the retyped literal this whole
 * transform exists to avoid.
 */
const MONO = '#FFFFFF';
const WAVE_ALPHA = '0.5';
const PROFILE_STROKE = 'url(#depth)';
const monoText = svgText
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<defs>[\s\S]*?<\/defs>/g, '')
  .replace(/(stroke|fill)="(?!none")([^"]*)"/g, (_match, attribute, value) =>
    attribute === 'stroke' && value !== PROFILE_STROKE
      ? `${attribute}="${MONO}" stroke-opacity="${WAVE_ALPHA}"`
      : `${attribute}="${MONO}"`,
  );
const strayColour = [...monoText.matchAll(/#[0-9A-Fa-f]{3,8}\b/g)]
  .map(([colour]) => colour)
  .find((colour) => colour.toUpperCase() !== MONO);
if (strayColour) {
  throw new Error(
    `the monochrome mark still carries ${strayColour}; DESIGN.md §0.1 allows the on-screen mark exactly one colour`,
  );
}

const out = path.join(root, 'assets', 'images');
fs.mkdirSync(out, { recursive: true });

// **Deliberately larger than anywhere it is drawn, and deliberately not an
// `@2x`/`@3x` set.** It is a source rather than a sprite: React Native scales
// it down to whatever `emptyStateMark` asks for, so the display size lives in
// exactly one place (the stylesheet) and there is no second number here to keep
// in step with it. 360 is 3× the 120 pt the empty state draws today, which is
// the densest screen this app runs on.
//
// **Trimmed to the ink, which the icons deliberately are not.** mark.svg's 64×64
// frame leaves roughly a fifth of its height empty above the wave and a quarter
// below the profile, and on a tile that emptiness is doing real work — it is what
// insets the mark from the icon's edge. In a text column it is not padding, it is
// a hole: left-aligned under the owner's design the block runs on a 16 pt rhythm
// and the mark sat 49 pt clear of the label beneath it, two and a half times every
// other gap. Measured off the simulator, not estimated.
//
// Trimming here rather than cropping at the call site is what keeps the geometry
// in one place: `resizeMode: 'cover'` with a shorter box would clip the mark the
// day the drawing changes, and a hand-computed `aspectRatio` in the sheet would be
// the drawing's proportions written down a second time. A trimmed asset carries
// its own aspect ratio, so `emptyStateMark` states a width and nothing else.
//
// Two passes, not one chain: sharp applies `trim` early in its own fixed pipeline
// order, so a `.resize().trim()` chain trims the source and then scales the
// untrimmed frame back over it — it returns 360×360 and looks exactly like a trim
// that did nothing. Rasterise, trim, then scale the trimmed result to width.
const monoFull = await sharp(Buffer.from(monoText)).png().toBuffer();
const monoScaled = await sharp(monoFull).trim().resize({ width: 360 }).png().toBuffer();
const { width: monoWidth, height: monoHeight } = await sharp(monoScaled).metadata();

// **The drawing is put entirely in the alpha channel, and the colour is laid down
// flat underneath it.** Not a tidy-up: resampling a white stroke over transparency
// mixes the two, and the downscale above produced pixels at `254,254,254` — one
// step off the ink, invisible to any eye and enough to make "this asset carries
// exactly one colour" false. Loosening the test to a tolerance was the wrong
// direction, because that property is §0.1 stated about a file: `tintColor`
// repaints RGB and keeps alpha, so the ink is a placeholder and the ALPHA is the
// mark. Building it that way makes the claim true by construction rather than by
// inspection, and `markAsset.test.ts` can go on asserting it exactly.
const monoAlpha = await sharp(monoScaled).extractChannel('alpha').toBuffer();
await sharp({
  create: { width: monoWidth, height: monoHeight, channels: 3, background: MONO },
})
  .joinChannel(monoAlpha)
  .png()
  .toFile(path.join(out, 'mark-mono.png'));
const monoMeta = { width: monoWidth, height: monoHeight };
console.log(
  `wrote assets/images/mark-mono.png (${monoMeta.width}×${monoMeta.height}, transparent, one colour)`,
);

const targets = [
  // Full-bleed store and home-screen icon.
  { file: 'icon.png', size: 1024, pad: 0 },
  // 112 is empirical, not derived from Android's safe-zone spec: at the
  // original pad of 224 the mark rendered as an illegible dot, and 112 is
  // the value that keeps it inside the safe zone while still reading
  // clearly at adaptive-icon size.
  { file: 'adaptive-icon.png', size: 1024, pad: 112 },
  // Splash art is composited on a flat background by expo-splash-screen.
  { file: 'splash-icon.png', size: 512, pad: 96 },
];

for (const { file, size, pad } of targets) {
  const inner = size - pad * 2;
  const mark = await sharp(svg).resize(inner, inner).png().toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: tokens.dark.bg },
  })
    .composite([{ input: mark, top: pad, left: pad }])
    .png()
    .toFile(path.join(out, file));
  console.log(`wrote assets/images/${file} (${size}px)`);
}
