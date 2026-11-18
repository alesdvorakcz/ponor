import { wordsOf } from './words';

/**
 * **The one guard for a stored list of words** (#69): a place's sets, the site's tiles, the
 * prefill's ways in, a dive's equipment and the CSV export all read their lists through it, so
 * none of them can disagree with another about what counts as a word.
 */
describe('wordsOf', () => {
  it('keeps each word in the list’s own order, trimmed, and one this build does not know', () => {
    expect(wordsOf(['wreck', ' boat', 'nitrox ', 'cavern'])).toEqual(['wreck', 'boat', 'nitrox', 'cavern']);
  });

  it('skips a number, a null and a blank, none of which is a word', () => {
    expect(wordsOf(['', '  ', 3, null, 'wall'])).toEqual(['wall']);
    expect(wordsOf(['', '  '])).toEqual([]);
  });

  it('is no words for a value that is not a list at all', () => {
    expect(wordsOf(null)).toEqual([]);
    expect(wordsOf('boat')).toEqual([]);
    expect(wordsOf({ boat: true })).toEqual([]);
  });
});
