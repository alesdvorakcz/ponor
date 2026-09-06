import { csvDocument, csvField, csvRecord, CSV_DELIMITER, CSV_RECORD_SEPARATOR } from './csv';

/**
 * **RFC 4180, asserted against literal text and never against a parser of our own.**
 *
 * This file's one discipline: every expectation below is a string spelled out by hand. A test
 * that wrote a CSV and then read it back with a reader from the same head would be checking
 * this module against itself, and the two would agree perfectly about a doubled quote that was
 * doubled in both directions. So nothing here parses anything.
 *
 * The one exception is the byte-order mark, which is asserted by **code point** rather than as
 * a character: a literal U+FEFF in a test file is invisible in every editor and diff, so an
 * assertion built out of one could be broken by an editor stripping it and nobody would see
 * the change. `0xfeff` is a number a reviewer can read.
 */

describe('csvField', () => {
  it('leaves ordinary text alone', () => {
    expect(csvField('Blue Hole')).toBe('Blue Hole');
    expect(csvField('')).toBe('');
    expect(csvField('24.6')).toBe('24.6');
  });

  it('keeps accents exactly as typed', () => {
    // The site name §5 names as the duplicate case, and the one the brief for this milestone
    // names as the thing that decides whether the export works at all.
    expect(csvField('Divoká Šárka')).toBe('Divoká Šárka');
  });

  it('quotes a field holding the delimiter', () => {
    expect(csvField('Deep, dark')).toBe('"Deep, dark"');
  });

  it('quotes a field holding a quote, and doubles the quote', () => {
    expect(csvField('the "chimney"')).toBe('"the ""chimney"""');
  });

  it('doubles every quote, not only the first', () => {
    expect(csvField('"a" and "b"')).toBe('"""a"" and ""b"""');
  });

  it('quotes a field holding a line feed, and keeps the line feed as typed', () => {
    expect(csvField('first line\nsecond line')).toBe('"first line\nsecond line"');
  });

  it('quotes a field holding a carriage return', () => {
    expect(csvField('first\r\nsecond')).toBe('"first\r\nsecond"');
  });

  it('handles the whole awkward set at once', () => {
    // A quote, the delimiter and a newline in one value — the note the brief asks for by name.
    expect(csvField('said ",\nthen left')).toBe('"said "",\nthen left"');
  });
});

describe('csvRecord', () => {
  it('joins fields with the delimiter', () => {
    expect(csvRecord(['a', 'b', 'c'])).toBe('a,b,c');
  });

  it('escapes each field on its way in', () => {
    expect(csvRecord(['Deep, dark', 'ok'])).toBe('"Deep, dark",ok');
  });

  it('keeps empty fields as empty positions rather than dropping them', () => {
    // The shape §0.4 requires of a value that was never recorded: a gap, still in its column.
    expect(csvRecord(['1', '', '', '4'])).toBe('1,,,4');
  });

  it('ends no record itself', () => {
    expect(csvRecord(['a'])).toBe('a');
  });
});

describe('csvDocument', () => {
  it('starts with a UTF-8 byte-order mark', () => {
    // Asserted as a code point, not as a character — see this file's own docblock.
    expect(csvDocument([['a']]).charCodeAt(0)).toBe(0xfeff);
  });

  it('terminates every record with CRLF, including the last', () => {
    expect(csvDocument([['a', 'b'], ['c', 'd']]).slice(1)).toBe('a,b\r\nc,d\r\n');
  });

  it('writes an empty document as the mark alone', () => {
    expect(csvDocument([]).slice(1)).toBe('');
  });

  it('escapes through the whole stack', () => {
    expect(csvDocument([['note'], ['said ",\nthen left']]).slice(1)).toBe(
      'note\r\n"said "",\nthen left"\r\n',
    );
  });
});

describe('the constants the escaping is built from', () => {
  // These two are read by `MUST_QUOTE` and by the record terminator, so they are not decoration:
  // a delimiter that changed without the quoting following it is a file that parses and lies.
  it('are the comma and CRLF RFC 4180 names', () => {
    expect(CSV_DELIMITER).toBe(',');
    expect(CSV_RECORD_SEPARATOR).toBe('\r\n');
  });
});
