import fs from 'node:fs';
import path from 'node:path';
import { assertHexColor, buildThemeCss } from './css';

describe('assertHexColor', () => {
  it('accepts a six-digit hex colour and returns it unchanged', () => {
    expect(assertHexColor('#EDEEEA')).toBe('#EDEEEA');
  });

  it('rejects a three-digit shorthand', () => {
    expect(() => assertHexColor('#FFF')).toThrow(TypeError);
  });

  it('rejects a named colour', () => {
    expect(() => assertHexColor('rebeccapurple')).toThrow(TypeError);
  });
});

describe('buildThemeCss', () => {
  const css = buildThemeCss();

  it('imports Tailwind and the NativeWind theme', () => {
    expect(css).toContain('@import "tailwindcss";');
    expect(css).toContain('@import "nativewind/theme";');
  });

  it('declares the light palette in an @theme block', () => {
    expect(css).toMatch(/@theme\s*\{[^}]*--color-bg:\s*#EDEEEA;/);
  });

  it('overrides the palette for dark under prefers-color-scheme', () => {
    const darkBlock = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
    expect(darkBlock).toContain('--color-bg: #080B0F;');
    expect(darkBlock).toContain('--color-fg: #F0F5F8;');
  });

  it('emits all six depth bands in both schemes', () => {
    const light = css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)'));
    const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
    for (let band = 1; band <= 6; band += 1) {
      expect(light).toContain(`--color-depth-${band}:`);
      expect(dark).toContain(`--color-depth-${band}:`);
    }
  });

  it('emits camelCase token names as kebab-case custom properties', () => {
    expect(css).toContain('--color-fg-muted:');
    expect(css).toContain('--color-action-fg:');
    expect(css).not.toContain('--color-fgMuted');
  });

  it('matches the checked-in global.css, so the two cannot drift', () => {
    const onDisk = fs.readFileSync(path.join(__dirname, '..', '..', 'global.css'), 'utf8');
    expect(onDisk).toBe(css);
  });
});
