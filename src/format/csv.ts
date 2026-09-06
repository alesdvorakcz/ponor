/**
 * **How a value becomes a CSV field, and what separates fields and records** — RFC 4180, and
 * the one owner of it (DESIGN.md §4.1).
 *
 * §8 promises "full data export any time — CSV for spreadsheets", and the promise is only
 * worth anything if a diver's own text survives it. **Text a diver typed can contain
 * anything**: a comma in a note, a quotation mark around a buddy's nickname, a newline in the
 * middle of a paragraph. Every one of those is a character this format gives a meaning to, so
 * quoting is not a nicety — it is the difference between a file that holds the logbook and a
 * file that holds a plausible rearrangement of it. A note reading `"Deep, dark", 3 sharks`
 * written raw turns one dive into four columns and shifts every later value one place left,
 * silently, for that row only.
 *
 * ── The rule, which is RFC 4180's and not ours ────────────────────────────────────────────
 *
 * A field is wrapped in double quotes when it contains a double quote, the delimiter, a
 * carriage return or a line feed; inside the wrapper every double quote is doubled. Nothing
 * else is touched — **the diver's text is never rewritten**, only wrapped. A newline inside a
 * note stays the newline they typed, which is why `CSV_RECORD_SEPARATOR` below is CRLF and the
 * escaping does not care which of the two it sees: a record ends at a separator *outside* a
 * quoted field, and both spellings are legal inside one.
 *
 * **Quoting only where it is needed, rather than always.** Quoting every field would also be
 * correct, and it would hide a defect this module exists to prevent: with every field wrapped,
 * a broken `"` → `""` rule produces a file that still parses and has the wrong content in it.
 * Minimal quoting makes the escaping visible in the output, which is what lets a test assert
 * against literal expected text rather than against its own parser.
 *
 * ── The BOM, which is what decides whether Excel is right ─────────────────────────────────
 *
 * `csvDocument` puts a UTF-8 byte-order mark at the front. Excel on Windows opens a `.csv`
 * with no BOM in the system code page, so `Divoká Šárka` arrives as `DivokÃ¡ Å árka` — a
 * mojibake site name in a file whose whole job is to be opened in a spreadsheet. The cost is
 * named rather than hidden: a strict parser that does not strip the mark reads the first
 * header with the mark still glued to its front. That trade is decided by §8's own wording — this
 * file is *for spreadsheets*, and the JSON beside it is the one for machines, which is why
 * that one carries no mark at all.
 *
 * ── The delimiter ────────────────────────────────────────────────────────────────────────
 *
 * A comma, RFC 4180's own. A Czech-locale Excel expects a semicolon and will show a
 * comma-separated file as one column until the diver picks a delimiter in the import dialog;
 * the alternatives are worse. `sep=,` as a first line is an Excel-only directive that every
 * other tool — Numbers, Sheets, pandas, `csv` — reads as a junk first record, and switching
 * the delimiter by language would make one diver's archive unreadable by the other's tools.
 */

/**
 * The field separator. Everything below reads this rather than a literal comma, so the
 * must-quote set cannot fall out of step with it.
 */
export const CSV_DELIMITER = ',';

/**
 * What ends a record. CRLF is RFC 4180's, and it is what Excel and Numbers both write; a bare
 * LF inside a quoted field is a diver's own newline and is left exactly as typed.
 */
export const CSV_RECORD_SEPARATOR = '\r\n';

/**
 * The UTF-8 byte-order mark — see this module's docblock for what it buys and what it costs.
 *
 * Written as an escape rather than as the character itself: a literal BOM in a source file is
 * invisible in every editor and diff, and this is the one constant in the app whose whole
 * purpose is to be a character nobody can see.
 */
export const UTF8_BOM = '\uFEFF';

/** The wrapper, and the character that has to be doubled inside one. */
const QUOTE = '"';

/**
 * The characters that force a field to be quoted: the wrapper itself, the delimiter, and both
 * halves of a line ending. Built from `CSV_DELIMITER` rather than typed out, so a delimiter
 * change cannot leave the escaping matching the old one.
 */
const MUST_QUOTE = [QUOTE, CSV_DELIMITER, '\r', '\n'];

/**
 * One field, escaped exactly as far as it has to be.
 *
 * A `/"/g` replace rather than `replaceAll`: the app runs on Hermes, and a global regex is the
 * spelling that is true everywhere the bundle goes.
 */
export function csvField(value: string): string {
  if (!MUST_QUOTE.some((character) => value.includes(character))) return value;
  return `${QUOTE}${value.replace(/"/g, `${QUOTE}${QUOTE}`)}${QUOTE}`;
}

/** One record: its fields escaped and joined by the delimiter. No line ending — that belongs
 * to the document, which is the only thing that knows whether another record follows. */
export function csvRecord(fields: readonly string[]): string {
  return fields.map(csvField).join(CSV_DELIMITER);
}

/**
 * A whole file: the byte-order mark, then every record, each terminated by CRLF.
 *
 * **Terminated rather than separated.** RFC 4180 permits either, and a trailing newline is what
 * every tool that ever appends to a text file assumes; a file whose last record has no ending
 * is one concatenation away from two dives on one line.
 */
export function csvDocument(records: readonly (readonly string[])[]): string {
  return (
    UTF8_BOM + records.map((record) => `${csvRecord(record)}${CSV_RECORD_SEPARATOR}`).join('')
  );
}
