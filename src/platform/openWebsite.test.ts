import * as Linking from 'expo-linking';

import { isOpenableWebsite, openWebsite } from './openWebsite';

jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));

const mockOpenURL = Linking.openURL as jest.MockedFunction<typeof Linking.openURL>;

beforeEach(() => {
  mockOpenURL.mockClear();
  mockOpenURL.mockResolvedValue(true);
});

/**
 * `platform/openWebsite.ts` — what this app will hand to the outside world (DESIGN.md §4.1).
 *
 * The value under test is **community text**: §6 gives `dive_centers` a nullable, unconstrained
 * `website`, it arrives from another diver through `push_changes`, and §1 never blocks a save. So
 * the interesting cases are all the ones that are not a URL.
 */
describe('isOpenableWebsite', () => {
  it('accepts an absolute http or https address', () => {
    expect(isOpenableWebsite('https://ponorka.example')).toBe(true);
    expect(isOpenableWebsite('http://ponorka.example/shop?x=1')).toBe(true);
    expect(isOpenableWebsite('  https://ponorka.example  ')).toBe(true);
    // The scheme is compared case-insensitively because `new URL` normalises it, which is worth
    // pinning rather than assuming: a row typed `HTTPS://…` is the same address.
    expect(isOpenableWebsite('HTTPS://ponorka.example')).toBe(true);
  });

  /**
   * **A bare hostname is not opened**, and this is the guard the whole module exists for.
   *
   * `openURL` with no scheme is not a web address to the platform, so the press either fails
   * silently or offers the string to another app; and guessing `https://` on the diver's behalf
   * would be inventing a fact about somebody else's shop. The row shows the text instead.
   */
  it('refuses an address with no scheme, rather than guessing one', () => {
    expect(isOpenableWebsite('ponorka.example')).toBe(false);
    expect(isOpenableWebsite('www.ponorka.example')).toBe(false);
    expect(isOpenableWebsite('//ponorka.example')).toBe(false);
  });

  /**
   * **Only http(s), never "any scheme the parser accepts."** `openURL` is a general door into
   * the device, and a catalogue row is text one diver types and every other diver reads — so the
   * set of things it can make another diver's phone do is bounded here rather than by whoever is
   * typing. Each of these parses perfectly well and none of them is a website.
   */
  it.each([
    'mailto:someone@example.com',
    'tel:+420123456789',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'ponor://dive/1',
    'data:text/html,<h1>hi</h1>',
  ])('refuses the scheme in %p', (value) => {
    expect(isOpenableWebsite(value)).toBe(false);
  });

  it('refuses nothing at all', () => {
    expect(isOpenableWebsite(null)).toBe(false);
    expect(isOpenableWebsite('')).toBe(false);
    expect(isOpenableWebsite('   ')).toBe(false);
    expect(isOpenableWebsite('not a url')).toBe(false);
  });
});

describe('openWebsite', () => {
  it('hands over the trimmed address it accepted, and nothing else', async () => {
    await openWebsite('  https://ponorka.example  ');
    expect(mockOpenURL).toHaveBeenCalledWith('https://ponorka.example');
  });

  // The check and the act cannot disagree: a value `isOpenableWebsite` refuses never reaches
  // the platform at all, so the row that is drawn as plain text is the row that would not open.
  it.each(['ponorka.example', 'mailto:someone@example.com', '', null])(
    'never hands over %p',
    async (value) => {
      await openWebsite(value);
      expect(mockOpenURL).not.toHaveBeenCalled();
    },
  );

  // A rejection is a dead press either way, and §0.6 objects four separate times to a message
  // with no gesture beneath it — so the failure is swallowed and the diver stays where they are.
  it('does not throw when the platform refuses to open it', async () => {
    mockOpenURL.mockRejectedValue(new Error('no handler'));
    await expect(openWebsite('https://ponorka.example')).resolves.toBeUndefined();
  });
});
