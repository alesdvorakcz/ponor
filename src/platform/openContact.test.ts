import * as Linking from 'expo-linking';

import { mailtoUrl, openContactUrl, telUrl } from './openContact';

jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));

const mockOpenURL = Linking.openURL as jest.MockedFunction<typeof Linking.openURL>;

beforeEach(() => {
  mockOpenURL.mockClear();
  mockOpenURL.mockResolvedValue(true);
});

describe('telUrl', () => {
  it('keeps the plus and the digits and drops the separators', () => {
    expect(telUrl('+385 21 555 0123')).toBe('tel:+385215550123');
    expect(telUrl('(021) 555-0123')).toBe('tel:0215550123');
    expect(telUrl('  021.555.0123 ')).toBe('tel:0215550123');
  });

  it('refuses text that is not a number', () => {
    for (const text of ['ask at the bar', '+385 21 555 0123 ext. 4', '12', '1+2', '', '   ', null]) {
      expect(telUrl(text)).toBeNull();
    }
  });
});

describe('mailtoUrl', () => {
  it('makes one plain address into a mailto', () => {
    expect(mailtoUrl(' dive@nautica-vis.example ')).toBe('mailto:dive@nautica-vis.example');
    expect(mailtoUrl('dive+club@nautica-vis.example')).toBe('mailto:dive+club@nautica-vis.example');
    expect(mailtoUrl('a.b_c-d@mail.nautica-vis.example')).toBe('mailto:a.b_c-d@mail.nautica-vis.example');
  });

  it('refuses what is not one plain address', () => {
    for (const text of [
      'nautica-vis.example',
      'dive@',
      'a b@c.example',
      'a@b@c.example',
      'x@y.example?bcc=z@w.example',
      'x@y.example,z@w.example',
      'dive@nautica.example%2Cspy%40evil.example',
      'a@b.example%3Fbcc%3Dspy%40evil.example',
      'a@b.example%0D%0ABcc%3Aspy%40evil.example',
      'a@b.example#frag',
      'a@b.example\u0000x',
      'a@b.example\r\nBcc: spy@evil.example',
      'a@b.example,c.example',
      'a@b.example;c.example',
      'a@b',
      'a@.example',
      'a@b..example',
      'x@y.example?subject=hi',
      // A `?` on its own, with nothing else the allowlist refuses beside it.
      'x@y.example?',
      'a?b@c.example',
      'x@y.example&cc=z',
      '',
      null,
    ]) {
      expect(mailtoUrl(text)).toBeNull();
    }
  });
});

describe('openContactUrl', () => {
  it('hands the address over as it is', async () => {
    await openContactUrl('tel:+385215550123');
    expect(mockOpenURL).toHaveBeenCalledWith('tel:+385215550123');
  });

  it('swallows a refusal to open', async () => {
    mockOpenURL.mockRejectedValue(new Error('no dialler'));
    await expect(openContactUrl('tel:+385215550123')).resolves.toBeUndefined();
  });
});
