const fs = require('fs');
const os = require('os');
const path = require('path');

const withTabGlyphs = require('./withTabGlyphs');
const {
  TAB_GLYPHS,
  parseGlyph,
  toIosSvg,
  iosContents,
  toVectorDrawable,
  writeIosGlyphs,
  writeAndroidGlyphs,
} = require('./withTabGlyphs');

const ROOT = path.join(__dirname, '..');
const read = (entry) => fs.readFileSync(path.join(ROOT, entry.svg), 'utf8');

// The bar asks the platform for each glyph BY NAME, and a name it cannot find is a tab with no
// glyph — nothing throws. So the names are the contract: Android resource names allow only
// lowercase letters, digits and underscores, and iOS takes the same string, so one name serves
// both. `navigation/tabs.test.ts` ties these names to the tabs that ask for them.
it('names every glyph in the one spelling both platforms accept', () => {
  for (const entry of TAB_GLYPHS) {
    expect(entry.name).toMatch(/^[a-z][a-z0-9_]*$/);
  }
  expect(new Set(TAB_GLYPHS.map((entry) => entry.name)).size).toBe(TAB_GLYPHS.length);
});

it.each(TAB_GLYPHS)('reads $svg as a 28 pt glyph drawn in the 22-unit canvas grid', (entry) => {
  const glyph = parseGlyph(read(entry));
  expect(glyph.size).toEqual({ width: 28, height: 28 });
  expect(glyph.viewBox).toEqual({ width: 22, height: 22 });
  expect(glyph.shapes.length).toBeGreaterThan(0);
});

// Every shape in the source must arrive on both platforms: a converter that dropped one would
// draw a two-stroke mark as a one-stroke mark on Android only, where nobody here can look.
it.each(TAB_GLYPHS)('converts every shape of $svg for both platforms', (entry) => {
  const glyph = parseGlyph(read(entry));
  const ios = toIosSvg(glyph);
  const android = toVectorDrawable(glyph);
  expect(ios.match(/<path /g)).toHaveLength(glyph.shapes.length);
  expect(android.match(/<path /g)).toHaveLength(glyph.shapes.length);
  expect(ios).toContain('width="28" height="28"');
  expect(android).toContain('android:width="28dp"');
  expect(android).toContain('android:viewportWidth="22"');
});

it('keeps the mark two strokes with round ends, and the sliders four filled shapes', () => {
  const mark = parseGlyph(read(TAB_GLYPHS.find((entry) => entry.name === 'tab_mark')));
  expect(mark.shapes.map((s) => [s.stroke, s.cap, s.join])).toEqual([
    [true, 'round', 'round'],
    [true, 'round', 'round'],
  ]);
  // The wave thinner than the profile: the canvas subordinates it by width (DESIGN.md §0.6).
  expect(mark.shapes.map((s) => s.width)).toEqual([1.6, 2]);
  const sliders = parseGlyph(read(TAB_GLYPHS.find((entry) => entry.name === 'tab_sliders')));
  expect(sliders.shapes).toHaveLength(4);
  expect(sliders.shapes.every((s) => s.stroke === false && s.d.endsWith('Z'))).toBe(true);
});

// **The exact drawing each platform gets, pinned** (review round 2). Android was never seen on
// a device, so this is the only thing that says its drawable paints at all: a converter that
// dropped `strokeColor`, rounded the caps away or filled with transparent would keep every
// count above green. Checked by hand against the SVGs' geometry when it was written — the
// polylines' points as they are, each rounded rect traced corner by corner from x, y, w, h, rx —
// so a change here means the drawing changed, and the SVG should say why.
const GOLDEN = {
  tab_mark: {
    android: [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<!-- Written by plugins/withTabGlyphs.js at prebuild from the SVG in assets/. Edit that, not this. -->',
      '<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="28dp" android:height="28dp" android:viewportWidth="22" android:viewportHeight="22">',
      '  <path android:pathData="M2,5.4L5.5,3.6L9,5.4L12.5,3.6L16,5.4L19.5,3.9" android:fillColor="#00000000" android:strokeColor="#FFFFFFFF" android:strokeWidth="1.6" android:strokeLineCap="round" android:strokeLineJoin="round"/>',
      '  <path android:pathData="M5,4.6L7.8,17L11.6,17L14,11.4L18.4,11.4" android:fillColor="#00000000" android:strokeColor="#FFFFFFFF" android:strokeWidth="2" android:strokeLineCap="round" android:strokeLineJoin="round"/>',
      '</vector>',
      '',
    ],
    ios: [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" width="28" height="28">',
      '<path d="M2,5.4L5.5,3.6L9,5.4L12.5,3.6L16,5.4L19.5,3.9" fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
      '<path d="M5,4.6L7.8,17L11.6,17L14,11.4L18.4,11.4" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
      '</svg>',
      '',
    ],
  },
  tab_sliders: {
    android: [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<!-- Written by plugins/withTabGlyphs.js at prebuild from the SVG in assets/. Edit that, not this. -->',
      '<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="28dp" android:height="28dp" android:viewportWidth="22" android:viewportHeight="22">',
      '  <path android:pathData="M3.8,6.4H18.2A0.8,0.8 0 0 1 19,7.2V7.2A0.8,0.8 0 0 1 18.2,8H3.8A0.8,0.8 0 0 1 3,7.2V7.2A0.8,0.8 0 0 1 3.8,6.4Z" android:fillColor="#FFFFFFFF"/>',
      '  <path android:pathData="M7.8,4.2H8.4A1.2,1.2 0 0 1 9.6,5.4V9A1.2,1.2 0 0 1 8.4,10.2H7.8A1.2,1.2 0 0 1 6.6,9V5.4A1.2,1.2 0 0 1 7.8,4.2Z" android:fillColor="#FFFFFFFF"/>',
      '  <path android:pathData="M3.8,14H18.2A0.8,0.8 0 0 1 19,14.8V14.8A0.8,0.8 0 0 1 18.2,15.6H3.8A0.8,0.8 0 0 1 3,14.8V14.8A0.8,0.8 0 0 1 3.8,14Z" android:fillColor="#FFFFFFFF"/>',
      '  <path android:pathData="M13.6,11.8H14.2A1.2,1.2 0 0 1 15.4,13V16.6A1.2,1.2 0 0 1 14.2,17.8H13.6A1.2,1.2 0 0 1 12.4,16.6V13A1.2,1.2 0 0 1 13.6,11.8Z" android:fillColor="#FFFFFFFF"/>',
      '</vector>',
      '',
    ],
    ios: [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" width="28" height="28">',
      '<path d="M3.8,6.4H18.2A0.8,0.8 0 0 1 19,7.2V7.2A0.8,0.8 0 0 1 18.2,8H3.8A0.8,0.8 0 0 1 3,7.2V7.2A0.8,0.8 0 0 1 3.8,6.4Z" fill="#FFFFFF"/>',
      '<path d="M7.8,4.2H8.4A1.2,1.2 0 0 1 9.6,5.4V9A1.2,1.2 0 0 1 8.4,10.2H7.8A1.2,1.2 0 0 1 6.6,9V5.4A1.2,1.2 0 0 1 7.8,4.2Z" fill="#FFFFFF"/>',
      '<path d="M3.8,14H18.2A0.8,0.8 0 0 1 19,14.8V14.8A0.8,0.8 0 0 1 18.2,15.6H3.8A0.8,0.8 0 0 1 3,14.8V14.8A0.8,0.8 0 0 1 3.8,14Z" fill="#FFFFFF"/>',
      '<path d="M13.6,11.8H14.2A1.2,1.2 0 0 1 15.4,13V16.6A1.2,1.2 0 0 1 14.2,17.8H13.6A1.2,1.2 0 0 1 12.4,16.6V13A1.2,1.2 0 0 1 13.6,11.8Z" fill="#FFFFFF"/>',
      '</svg>',
      '',
    ],
  },
};

it.each(TAB_GLYPHS)('writes exactly the pinned drawing of $name for both platforms', (entry) => {
  const glyph = parseGlyph(read(entry));
  expect(toVectorDrawable(glyph)).toBe(GOLDEN[entry.name].android.join('\n'));
  expect(toIosSvg(glyph)).toBe(GOLDEN[entry.name].ios.join('\n'));
});

it('turns a rounded rect into a closed path with its corners', () => {
  const glyph = parseGlyph(
    '<svg viewBox="0 0 22 22" width="28" height="28"><rect x="3" y="6" width="16" height="2" rx="1" fill="#FFFFFF"/></svg>',
  );
  expect(glyph.shapes[0].d).toBe('M4,6H18A1,1 0 0 1 19,7V7A1,1 0 0 1 18,8H4A1,1 0 0 1 3,7V7A1,1 0 0 1 4,6Z');
});

// The guard that keeps the two platforms one drawing — and that drawing the source's: a shape
// the converter does not know, a second ink, or anything it would silently drop stops the
// prebuild rather than shipping a glyph that differs from its SVG.
const glyph = (inner) => `<svg viewBox="0 0 22 22" width="28" height="28">${inner}</svg>`;

// Square, or the three outputs disagree: iOS would letterbox the SVG, Android stretch the
// drawable, and the browser PNG be cropped square.
it.each([
  ['a size that is not square', '<svg viewBox="0 0 22 22" width="28" height="20"><rect width="2" height="2" fill="#FFFFFF"/></svg>'],
  ['a viewBox that is not square', '<svg viewBox="0 0 22 16" width="28" height="28"><rect width="2" height="2" fill="#FFFFFF"/></svg>'],
])('refuses %s', (_what, svg) => {
  expect(() => parseGlyph(svg)).toThrow(/must be square/);
});

it('refuses a shape it cannot convert, and any ink but the placeholder', () => {
  expect(() => parseGlyph(glyph('<circle cx="1" cy="1" r="1" fill="#FFFFFF"/>'))).toThrow(/circle/);
  expect(() => parseGlyph(glyph('<rect width="2" height="2" fill="#FF6B4A"/>'))).toThrow(/one ink/);
});

it.each([
  ['a transform', '<rect width="2" height="2" fill="#FFFFFF" transform="rotate(45 1 1)"/>', /transform/],
  ['an opacity', '<rect width="2" height="2" fill="#FFFFFF" opacity="0.5"/>', /opacity/],
  ['a style', '<rect width="2" height="2" style="fill:#FFFFFF"/>', /style/],
  ['an ry', '<rect width="2" height="2" rx="1" ry="0.5" fill="#FFFFFF"/>', /ry/],
  ['a stroke opacity', '<polyline points="0,0 1,1" fill="none" stroke="#FFFFFF" stroke-opacity="0.5"/>', /stroke-opacity/],
  ['both a stroke and a fill', '<rect width="2" height="2" fill="#FFFFFF" stroke="#FFFFFF"/>', /both stroked and filled/],
  ['no word on fill', '<polyline points="0,0 1,1" stroke="#FFFFFF"/>', /fill="none"/],
  // Written another way, an attribute never reaches the list above, so the tag itself must be
  // nothing but name="value" pairs.
  ['a single-quoted attribute', `<rect width="2" height="2" fill="#FFFFFF" transform='rotate(45 1 1)'/>`, /cannot read/],
  ['spaces around =', '<rect width="2" height="2" fill="#FFFFFF" transform = "rotate(45)"/>', /cannot read/],
  ['a blank number', '<rect width="" height="2" fill="#FFFFFF"/>', /width is missing/],
  ['a corner Android cannot draw', '<polyline points="0,0 1,1" fill="none" stroke="#FFFFFF" stroke-linejoin="arcs"/>', /stroke-linejoin/],
  ['an end Android cannot draw', '<polyline points="0,0 1,1" fill="none" stroke="#FFFFFF" stroke-linecap="triangle"/>', /stroke-linecap/],
  // SVG would draw elliptical corners there, and the converted paths are circular.
  ['a corner radius past half the rect', '<rect width="16" height="1.6" rx="1.2" fill="#FFFFFF"/>', /more than half/],
])('refuses %s rather than dropping it', (_what, inner, message) => {
  expect(() => parseGlyph(glyph(inner))).toThrow(message);
});

// Kept as a vector, so the accessibility magnifier enlarges a vector rather than a bitmap, and
// declared a template — which states what the image is for, though it is not what makes the
// bar tint it: expo-router and react-native-screens set the mode from the bar's `iconColor`
// (`NativeTabIcon` in src/navigation/tabs.ts; `tabs.test.ts` pins that colour on iOS).
it('marks the iOS image set as a template vector', () => {
  expect(iosContents('tab_mark.svg')).toEqual({
    images: [{ filename: 'tab_mark.svg', idiom: 'universal' }],
    info: { author: 'xcode', version: 1 },
    properties: { 'preserves-vector-representation': true, 'template-rendering-intent': 'template' },
  });
});

it('writes an image set per glyph into the asset catalog, and a drawable per glyph', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-glyphs-'));
  try {
    writeIosGlyphs(ROOT, path.join(dir, 'Images.xcassets'));
    writeAndroidGlyphs(ROOT, path.join(dir, 'drawable'));
    for (const { name } of TAB_GLYPHS) {
      const set = path.join(dir, 'Images.xcassets', `${name}.imageset`);
      expect(JSON.parse(fs.readFileSync(path.join(set, 'Contents.json'), 'utf8')).images[0].filename).toBe(`${name}.svg`);
      expect(fs.readFileSync(path.join(set, `${name}.svg`), 'utf8')).toMatch(/^<svg /);
      expect(fs.readFileSync(path.join(dir, 'drawable', `${name}.xml`), 'utf8')).toContain('<vector ');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// **Where the files land is the contract with Xcode and Gradle.** The tests above write into
// folders they choose; these run the mods the plugin actually registers, against a pretend
// prebuild, so a wrong path in them — a glyph written beside the asset catalog rather than in
// it, or outside `res/drawable` — fails here instead of as a tab with no glyph on a device.
describe('the registered prebuild mods', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-glyph-mods-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = (platform, modRequest) =>
    withTabGlyphs({ name: 'Ponor', slug: 'ponor' }).mods[platform].dangerous({
      name: 'Ponor',
      slug: 'ponor',
      modRequest: { projectRoot: ROOT, platform, modName: 'dangerous', introspect: false, ...modRequest },
    });

  it('writes each glyph into the app target’s own asset catalog on iOS', async () => {
    await run('ios', { platformProjectRoot: path.join(dir, 'ios'), projectName: 'Ponor' });
    for (const { name } of TAB_GLYPHS) {
      const set = path.join(dir, 'ios', 'Ponor', 'Images.xcassets', `${name}.imageset`);
      expect(fs.existsSync(path.join(set, 'Contents.json'))).toBe(true);
      expect(fs.existsSync(path.join(set, `${name}.svg`))).toBe(true);
    }
  });

  it('stops the prebuild when the iOS project has no name to find its catalog by', async () => {
    await expect(run('ios', { platformProjectRoot: path.join(dir, 'ios') })).rejects.toThrow(/no name/);
    expect(fs.existsSync(path.join(dir, 'ios', 'Images.xcassets'))).toBe(false);
  });

  it('writes each glyph into the app module’s res/drawable on Android', async () => {
    await run('android', { platformProjectRoot: path.join(dir, 'android') });
    for (const { name } of TAB_GLYPHS) {
      expect(fs.existsSync(path.join(dir, 'android', 'app', 'src', 'main', 'res', 'drawable', `${name}.xml`))).toBe(true);
    }
  });
});
