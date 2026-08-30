import { useWindowDimensions } from 'react-native';

/**
 * DESIGN.md §3 (Tablets): "list + detail side by side" on wide screens, same
 * codebase. 900 is the line — an iPad mini in PORTRAIT (744 pt) still reads
 * better as one column (its content area is barely wider than a large
 * phone's), while an iPad in LANDSCAPE (1024 pt) is comfortably wide enough
 * for a fixed-width list column plus a readable detail pane beside it. 900
 * itself counts as wide (`>=`), so the boundary has one unambiguous side.
 *
 * Kept as a plain function of `width`, separate from `useWideLayout` below,
 * because THIS is the part worth testing: a pure predicate can be pinned at
 * the threshold itself (`useWideLayout.test.ts`) without rendering anything
 * or mocking `useWindowDimensions`. The hook is then a two-line wrapper with
 * no branch of its own to get wrong, so it carries no test of its own — see
 * that file's own note on this split.
 */
export function isWide(width: number): boolean {
  return width >= 900;
}

/**
 * Live version of `isWide`, over the window's current width. Re-renders
 * whatever calls this as the device rotates or (web/split-view) the window
 * resizes, since `useWindowDimensions` itself does.
 *
 * Deliberately not tested here: with `isWide` already pinned at its
 * boundary, this hook has no logic of its own left to break — only
 * `useWindowDimensions`'s own behaviour, which is React Native's to test,
 * not this app's.
 */
export function useWideLayout(): boolean {
  const { width } = useWindowDimensions();
  return isWide(width);
}
