// @ts-check
/**
 * **One of Ponor's tab glyphs rendered as the browser's PNG** — shared by the build
 * (`scripts/build-icons.mjs`, which writes the files) and the test that holds the committed
 * files to their SVGs (`src/theme/markAsset.test.ts`), so the two cannot render differently.
 *
 * It renders exactly what the iOS app holds — `toIosSvg` of the parsed glyph, from
 * `plugins/withTabGlyphs.js` — at the SVG's own point size times `scale`, and puts the drawing
 * in the alpha channel over one flat ink, the way the first-run mark is built: the bars tint
 * every opaque pixel, so the alpha is the glyph and the ink is a placeholder.
 */
const sharp = require('sharp');

const { INK, parseGlyph, toIosSvg } = require('../plugins/withTabGlyphs.js');

/**
 * @param {string} svgText the glyph's source SVG
 * @param {number} scale 1, 2 or 3
 * @returns {Promise<Buffer>} a PNG, `width × scale` square
 */
async function renderTabGlyphPng(svgText, scale) {
  const glyph = parseGlyph(svgText);
  const px = glyph.size.width * scale;
  const drawn = await sharp(Buffer.from(toIosSvg(glyph)), { density: (72 * px) / glyph.size.width })
    .resize(px, px)
    .png()
    .toBuffer();
  const alpha = await sharp(drawn).ensureAlpha().extractChannel('alpha').toBuffer();
  return sharp({ create: { width: px, height: px, channels: 3, background: INK } })
    .joinChannel(alpha)
    .png()
    .toBuffer();
}

module.exports = { renderTabGlyphPng };
