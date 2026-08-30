import { isWide } from './useWideLayout';

// DESIGN.md §3: "list + detail side by side" on wide screens. The three widths are real
// devices, not arbitrary points, and are chosen to prove more than "some tablet is wide":
// a phone in portrait, an iPad mini in PORTRAIT (the narrowest tablet — still one column,
// so this isn't just "any tablet counts"), and an iPad in LANDSCAPE (the first case
// DESIGN.md actually calls for side by side).
it('is narrow on a phone and wide on a tablet', () => {
  expect(isWide(390)).toBe(false); // iPhone 17 Pro
  expect(isWide(744)).toBe(false); // iPad mini portrait — still one column
  expect(isWide(1024)).toBe(true); // iPad landscape
});

// The three widths above all sit comfortably away from wherever the threshold actually
// falls (744 -> 1024 is a 280px gap) — none of them would catch the boundary drifting by
// even 100px in either direction. This milestone's own reports name that exact shape
// ("a test at 320 and 1400 proves nothing about where the boundary actually sits") as the
// recurring gap, so it is pinned here separately, on the pixel either side of 900: 899 is
// still narrow, 900 itself already reads as wide.
it('draws the line at exactly 900px, wide inclusive', () => {
  expect(isWide(899)).toBe(false);
  expect(isWide(900)).toBe(true);
});
