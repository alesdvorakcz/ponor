import { render, type RenderResult } from '@testing-library/react-native';
import { SymbolView } from 'expo-symbols';

import { ACCOUNT_PERK_GLYPHS, AccountPerks } from './AccountPerks';

// `SymbolView` mocked so the glyph each perk HANDS the library can be read, the boundary
// `symbolName.test.tsx` records — a real `SymbolView.ios.tsx` rewrites `name` before any host
// node sees it.
jest.mock('expo-symbols', () => ({ SymbolView: jest.fn(() => null) }));
const mockSymbolView = SymbolView as unknown as jest.Mock;

afterEach(() => mockSymbolView.mockClear());

function textsIn(t: RenderResult): string[] {
  const nodes = t.root ? [t.root, ...t.root.queryAll(() => true)] : [];
  return nodes
    .filter((n) => n.type === 'Text')
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

function glyphsDrawn(): string[] {
  return mockSymbolView.mock.calls.map((call) => call[0]?.name?.ios as string);
}

it('says the three perks as words, each beside its glyph, in one order', async () => {
  const t = await render(<AccountPerks scheme="dark" variant="words" />);
  expect(textsIn(t)).toEqual(['Backups', 'Every device', 'Community']);
  expect(glyphsDrawn()).toEqual(ACCOUNT_PERK_GLYPHS.map((g) => g.ios));
});

it('says the same three as sentences for the account screen, in the same order', async () => {
  const t = await render(<AccountPerks scheme="light" variant="sentences" />);
  expect(textsIn(t)).toEqual([
    'Your dives backed up as you log them',
    'Your logbook on your other devices',
    'Share new sites and centres with other divers',
  ]);
  expect(glyphsDrawn()).toEqual(ACCOUNT_PERK_GLYPHS.map((g) => g.ios));
});

it('keeps each glyph away from a screen reader, since the words beside it say it', async () => {
  await render(<AccountPerks scheme="dark" variant="words" />);
  for (const call of mockSymbolView.mock.calls) {
    expect(call[0]?.accessible).toBe(false);
  }
});
