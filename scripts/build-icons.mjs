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

const out = path.join(root, 'assets', 'images');
fs.mkdirSync(out, { recursive: true });

const targets = [
  // Full-bleed store and home-screen icon.
  { file: 'icon.png', size: 1024, pad: 0 },
  // Android masks the outer ~33%, so the mark sits in the safe centre.
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
