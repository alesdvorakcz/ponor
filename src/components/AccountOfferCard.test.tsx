import { cleanup, fireEvent, render, screen, type RenderResult } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';

import { setActiveLanguage } from '../i18n';
import { makeStyles } from '../theme/styles';
import { AccountOfferCard, OrRule } from './AccountOfferCard';

function textIn(t: RenderResult): string {
  const nodes = t.root ? [t.root, ...t.root.queryAll(() => true)] : [];
  return nodes
    .filter((n) => n.type === 'Text')
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string')
    .join(' ');
}

it('says what an account adds, and that it is optional', async () => {
  const t = await render(<AccountOfferCard scheme="dark" onPress={() => {}} />);
  const text = textIn(t);
  // The title promises no backup: on the first-run screen there is nothing to back up yet.
  expect(text).toContain('Better with an account');
  expect(text).toContain('Totally optional — Ponor works fully without one.');
  expect(text).toContain('Backups');
  expect(text).toContain('Every device');
  expect(text).toContain('Community');
});

it('opens the account screen through the button it carries', async () => {
  const onPress = jest.fn();
  await render(<AccountOfferCard scheme="dark" onPress={onPress} />);
  fireEvent.press(screen.getByRole('button', { name: 'Sign in or create an account' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('draws its button outlined, never as the inverted primary', async () => {
  await render(<AccountOfferCard scheme="light" onPress={() => {}} />);
  const styles = makeStyles('light');
  const button = StyleSheet.flatten(screen.getByRole('button', { name: 'Sign in or create an account' }).props.style);
  // The inverted fill is *Log your first dive*'s, and the card sits right under it.
  expect(button).toMatchObject(StyleSheet.flatten(styles.accountOfferButton));
  expect(button.backgroundColor).not.toBe(StyleSheet.flatten(styles.action).backgroundColor);
  expect(button.borderWidth).toBe(1);
});

it('lets the three words wrap rather than clip', async () => {
  const t = await render(<AccountOfferCard scheme="dark" onPress={() => {}} />);
  const styles = makeStyles('dark');
  // Czech runs 20–30 % longer (§0.5): three words that fit in English must be free to take a
  // second line rather than run off the card.
  expect(StyleSheet.flatten(styles.accountPerkWords).flexWrap).toBe('wrap');
  if (t.root === null) throw new Error('the card drew nothing');
  const row = t.root.queryAll((n) => n.type === 'View' && StyleSheet.flatten(n.props.style) === StyleSheet.flatten(styles.accountPerkWords));
  expect(row.length).toBeGreaterThan(0);
});

it('says “or” between two rules', async () => {
  const t = await render(<OrRule scheme="dark" />);
  expect(textIn(t)).toBe('or');
});

describe('in Czech', () => {
  beforeEach(async () => {
    await setActiveLanguage('cs');
  });
  afterEach(async () => {
    cleanup();
    await setActiveLanguage('en');
  });

  it('says the card and the rule in Czech', async () => {
    const t = await render(
      // One View rather than a fragment: `root` is the first host element, and a fragment has two.
      <View>
        <OrRule scheme="dark" />
        <AccountOfferCard scheme="dark" onPress={() => {}} />
      </View>,
    );
    const text = textIn(t);
    expect(text).toContain('nebo');
    expect(text).toContain('S účtem je to lepší');
    expect(text).toContain('Zcela volitelné — Ponor funguje i bez něj.');
    expect(text).toContain('Zálohy');
    expect(text).toContain('Všechna zařízení');
    expect(text).toContain('Komunita');
    expect(screen.getByRole('button', { name: 'Přihlásit se nebo vytvořit účet' })).toBeTruthy();
  });
});
