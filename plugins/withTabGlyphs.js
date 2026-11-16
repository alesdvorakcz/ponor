// @ts-check
/**
 * **Ponor's own tab glyphs, as vectors in the native apps** (issue #2, the owner's call).
 *
 * The tab bar is `NativeTabs` — UIKit's and Material's own bars — and neither can be handed an
 * SVG at runtime. They can be handed a NAME: an image in the iOS asset catalog (`xcasset`) or an
 * Android drawable resource (`drawable`). This config plugin puts each glyph there at prebuild,
 * from the one SVG in `assets/`:
 *
 * - **iOS:** an image set in `Images.xcassets` holding the SVG, with `preserves-vector-
 *   representation` (so the accessibility magnifier enlarges a vector, not a bitmap) and
 *   `template-rendering-intent: template`. That intent states what the image is for, but it is
 *   NOT what makes the bar tint it: expo-router and react-native-screens force the rendering
 *   mode themselves, `template` only while the bar has an `iconColor` (`NativeTabIcon` in
 *   `src/navigation/tabs.ts` has the trace, and `tabs.test.ts` pins the colour).
 * - **Android:** a `VectorDrawable` written from the same shapes. Material tints a tab icon by
 *   itself, so the drawing's own ink is a placeholder there too.
 *
 * Both are written from ONE parse of the SVG, so the two platforms cannot be handed two
 * different drawings. The parser is deliberately small — it reads exactly the shapes and
 * attributes these glyphs use and **throws on anything else**: another element, an attribute
 * outside its list (a `transform`, an `opacity`, a `style`, an `ry`), a shape both stroked and
 * filled, or a shape that does not say whether it is filled. So a glyph redrawn with something
 * it does not understand fails the prebuild instead of drawing differently from its source.
 *
 * **It is native configuration:** the glyphs exist only in a binary built after this plugin
 * ran. A dev client or TestFlight build from before it shows those tabs with no glyph at all,
 * because the bar asks for an image by name and gets nothing back. DESIGN.md §10 records that.
 * The browser never comes here; its JS bar draws PNGs built from the same SVGs by
 * `scripts/build-icons.mjs`.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

/** Every glyph this plugin installs: the resource name both apps know it by, and its SVG. */
const TAB_GLYPHS = [
  { name: 'tab_mark', svg: 'assets/tab-mark.svg' },
  { name: 'tab_sliders', svg: 'assets/tab-sliders.svg' },
];

/** The one ink a glyph's source may use: the bars tint it, so it is never seen. */
const INK = '#FFFFFF';

function num(value, what) {
  // `Number('')` is 0, so a blank value would otherwise pass as a zero-sized shape.
  if (value === undefined || value.trim() === '') throw new Error(`tab glyph: ${what} is missing`);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`tab glyph: ${what} is not a number (${value})`);
  return n;
}

/** Rounded and stripped, so a converted path does not carry floating-point noise. */
function fmt(n) {
  return String(Math.round(n * 1000) / 1000);
}

const PAIR = /\s([\w:-]+)="([^"]*)"/g;

/**
 * A tag's attributes — and only if the whole tag is `name="value"` pairs. Anything else in it
 * (a single-quoted value, spaces around `=`, a bare word) is text this tokenizer would skip,
 * and a skipped `transform` would be a silently different drawing, so it throws instead.
 */
function attributes(tag) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [, key, value] of tag.matchAll(PAIR)) out[key] = value;
  const rest = tag.replace(/^<[a-zA-Z][\w-]*/, '').replace(PAIR, '').replace(/\/?>$/, '');
  if (rest.trim() !== '') {
    throw new Error(`tab glyph: cannot read "${rest.trim()}" in ${tag} — write attributes as name="value"`);
  }
  return out;
}

/** The stroke ends and corners both platforms draw the same way (Android allows no others). */
const CAPS = ['butt', 'round', 'square'];
const JOINS = ['miter', 'round', 'bevel'];

function oneOf(value, allowed, what) {
  if (!allowed.includes(value)) throw new Error(`tab glyph: ${what}="${value}" is not one of ${allowed.join(', ')}`);
  return value;
}

/**
 * The attributes each element may carry — everything this parser reads, and nothing it would
 * silently ignore. An attribute outside the list changes the drawing in a way the conversion
 * would drop (a `transform`, an `opacity`), so it is refused rather than lost.
 */
const ALLOWED = {
  svg: ['xmlns', 'viewBox', 'width', 'height'],
  polyline: ['points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'],
};

function checkAttributes(name, attrs) {
  const allowed = ALLOWED[name];
  for (const key of Object.keys(attrs)) {
    if (!allowed.includes(key)) {
      throw new Error(`tab glyph: <${name}> carries ${key}="${attrs[key]}", which this plugin would not convert`);
    }
  }
}

function inkOf(attrs, key) {
  const value = attrs[key];
  if (value === undefined || value === 'none') return null;
  if (value.toUpperCase() !== INK) {
    throw new Error(`tab glyph: ${key}="${value}" — a tab glyph is one ink (${INK}), tinted by the bar`);
  }
  return INK;
}

function roundedRectPath(x, y, w, h, rx) {
  const r = Math.min(rx, w / 2, h / 2);
  if (r <= 0) return `M${fmt(x)},${fmt(y)}H${fmt(x + w)}V${fmt(y + h)}H${fmt(x)}Z`;
  const arc = (ex, ey) => `A${fmt(r)},${fmt(r)} 0 0 1 ${fmt(ex)},${fmt(ey)}`;
  return [
    `M${fmt(x + r)},${fmt(y)}`,
    `H${fmt(x + w - r)}`,
    arc(x + w, y + r),
    `V${fmt(y + h - r)}`,
    arc(x + w - r, y + h),
    `H${fmt(x + r)}`,
    arc(x, y + h - r),
    `V${fmt(y + r)}`,
    arc(x + r, y),
    'Z',
  ].join('');
}

/**
 * One glyph's SVG reduced to what both platforms draw: its size in points, its viewBox, and a
 * list of shapes, each a path that is either stroked or filled in the one ink.
 */
function parseGlyph(svgText) {
  const text = svgText.replace(/<!--[\s\S]*?-->/g, '');
  const root = text.match(/<svg\b[^>]*>/);
  if (!root) throw new Error('tab glyph: no <svg> element');
  const rootAttrs = attributes(root[0]);
  checkAttributes('svg', rootAttrs);
  const viewBox = (rootAttrs.viewBox ?? '').trim().split(/\s+/).map((v) => num(v, 'viewBox'));
  if (viewBox.length !== 4 || viewBox[0] !== 0 || viewBox[1] !== 0) {
    throw new Error(`tab glyph: viewBox must be "0 0 w h" (${rootAttrs.viewBox})`);
  }
  const size = { width: num(rootAttrs.width, 'width'), height: num(rootAttrs.height, 'height') };
  const shapes = [];
  const body = text.slice(text.indexOf(root[0]) + root[0].length, text.lastIndexOf('</svg>'));
  for (const [tag, name] of body.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*\/?>/g)) {
    if (!(name in ALLOWED) || name === 'svg') {
      throw new Error(`tab glyph: <${name}> is not a shape this plugin converts (polyline, rect)`);
    }
    const attrs = attributes(tag);
    checkAttributes(name, attrs);
    // SVG fills a shape that says nothing about `fill` (black, by default), which is easy to
    // forget on a stroked polyline; requiring the word makes the intent explicit either way.
    if (attrs.fill === undefined) {
      throw new Error(`tab glyph: <${name}> must say fill="none" or fill="${INK}"`);
    }
    const stroke = inkOf(attrs, 'stroke');
    const fill = inkOf(attrs, 'fill');
    if (stroke && fill) {
      throw new Error(`tab glyph: <${name}> is both stroked and filled; draw it as one or the other`);
    }
    let d;
    if (name === 'polyline') {
      const points = (attrs.points ?? '').trim().split(/\s+/).map((pair) => pair.split(',').map((v) => num(v, 'point')));
      if (points.length < 2 || points.some((p) => p.length !== 2)) throw new Error('tab glyph: a polyline needs two or more x,y points');
      d = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${fmt(x)},${fmt(y)}`).join('');
    } else {
      d = roundedRectPath(num(attrs.x ?? '0', 'x'), num(attrs.y ?? '0', 'y'), num(attrs.width, 'width'), num(attrs.height, 'height'), num(attrs.rx ?? '0', 'rx'));
    }
    if (stroke) {
      shapes.push({
        d,
        stroke: true,
        width: num(attrs['stroke-width'] ?? '1', 'stroke-width'),
        cap: oneOf(attrs['stroke-linecap'] ?? 'butt', CAPS, 'stroke-linecap'),
        join: oneOf(attrs['stroke-linejoin'] ?? 'miter', JOINS, 'stroke-linejoin'),
      });
    } else if (fill) {
      shapes.push({ d, stroke: false });
    } else {
      throw new Error(`tab glyph: <${name}> draws nothing (no stroke, no fill)`);
    }
  }
  if (shapes.length === 0) throw new Error('tab glyph: no shapes');
  return { size, viewBox: { width: viewBox[2], height: viewBox[3] }, shapes };
}

/** The glyph as iOS's asset catalog takes it: plain paths, no comments, at its size in points. */
function toIosSvg(glyph) {
  const paths = glyph.shapes.map((s) =>
    s.stroke
      ? `<path d="${s.d}" fill="none" stroke="${INK}" stroke-width="${fmt(s.width)}" stroke-linecap="${s.cap}" stroke-linejoin="${s.join}"/>`
      : `<path d="${s.d}" fill="${INK}"/>`,
  );
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(glyph.viewBox.width)} ${fmt(glyph.viewBox.height)}" width="${fmt(glyph.size.width)}" height="${fmt(glyph.size.height)}">`,
    ...paths,
    '</svg>',
    '',
  ].join('\n');
}

/** The image set's `Contents.json`: one vector, kept as a vector, drawn as a template. */
function iosContents(fileName) {
  return {
    images: [{ filename: fileName, idiom: 'universal' }],
    info: { author: 'xcode', version: 1 },
    properties: { 'preserves-vector-representation': true, 'template-rendering-intent': 'template' },
  };
}

/** The glyph as an Android `VectorDrawable`. */
function toVectorDrawable(glyph) {
  const paths = glyph.shapes.map((s) =>
    s.stroke
      ? `  <path android:pathData="${s.d}" android:fillColor="#00000000" android:strokeColor="#FFFFFFFF" android:strokeWidth="${fmt(s.width)}" android:strokeLineCap="${s.cap}" android:strokeLineJoin="${s.join}"/>`
      : `  <path android:pathData="${s.d}" android:fillColor="#FFFFFFFF"/>`,
  );
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- Written by plugins/withTabGlyphs.js at prebuild from the SVG in assets/. Edit that, not this. -->',
    `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="${fmt(glyph.size.width)}dp" android:height="${fmt(glyph.size.height)}dp" android:viewportWidth="${fmt(glyph.viewBox.width)}" android:viewportHeight="${fmt(glyph.viewBox.height)}">`,
    ...paths,
    '</vector>',
    '',
  ].join('\n');
}

function readGlyph(projectRoot, entry) {
  return parseGlyph(fs.readFileSync(path.join(projectRoot, entry.svg), 'utf8'));
}

/** Writes every glyph into an asset catalog (`…/Images.xcassets`). */
function writeIosGlyphs(projectRoot, xcassets) {
  for (const entry of TAB_GLYPHS) {
    const dir = path.join(xcassets, `${entry.name}.imageset`);
    fs.mkdirSync(dir, { recursive: true });
    const file = `${entry.name}.svg`;
    fs.writeFileSync(path.join(dir, file), toIosSvg(readGlyph(projectRoot, entry)));
    fs.writeFileSync(path.join(dir, 'Contents.json'), `${JSON.stringify(iosContents(file), null, 2)}\n`);
  }
}

/** Writes every glyph into an Android `res/drawable` folder. */
function writeAndroidGlyphs(projectRoot, drawableDir) {
  fs.mkdirSync(drawableDir, { recursive: true });
  for (const entry of TAB_GLYPHS) {
    fs.writeFileSync(path.join(drawableDir, `${entry.name}.xml`), toVectorDrawable(readGlyph(projectRoot, entry)));
  }
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
function withTabGlyphs(config) {
  config = withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const { projectRoot, platformProjectRoot, projectName } = cfg.modRequest;
      // Without the project's name the catalog path would be `ios/Images.xcassets`, outside
      // the app target, and the tabs would quietly have no glyphs; stop the prebuild instead.
      if (!projectName) throw new Error('tab glyph: the iOS project has no name to find its Images.xcassets by');
      writeIosGlyphs(projectRoot, path.join(platformProjectRoot, projectName, 'Images.xcassets'));
      return cfg;
    },
  ]);
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const { projectRoot, platformProjectRoot } = cfg.modRequest;
      writeAndroidGlyphs(projectRoot, path.join(platformProjectRoot, 'app', 'src', 'main', 'res', 'drawable'));
      return cfg;
    },
  ]);
}

module.exports = withTabGlyphs;
module.exports.TAB_GLYPHS = TAB_GLYPHS;
module.exports.INK = INK;
module.exports.parseGlyph = parseGlyph;
module.exports.toIosSvg = toIosSvg;
module.exports.iosContents = iosContents;
module.exports.toVectorDrawable = toVectorDrawable;
module.exports.writeIosGlyphs = writeIosGlyphs;
module.exports.writeAndroidGlyphs = writeAndroidGlyphs;
