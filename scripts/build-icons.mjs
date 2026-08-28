import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { tokens } = require('../src/theme/tokens.js');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(root, 'assets', 'mark.svg'));
const out = path.join(root, 'assets', 'images');
fs.mkdirSync(out, { recursive: true });

const targets = [
  // Full-bleed store and home-screen icon.
  { file: 'icon.png', size: 1024, pad: 0 },
  // Android masks the outer ~33%, so the mark sits in the safe centre.
  { file: 'adaptive-icon.png', size: 1024, pad: 224 },
  // Splash art is composited on a flat background by expo-splash-screen.
  { file: 'splash-icon.png', size: 512, pad: 128 },
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
