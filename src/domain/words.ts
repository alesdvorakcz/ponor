/**
 * **The words in a stored list**, in the list's own order: each string, trimmed, that is not
 * blank, and nothing from a value that is not a list at all.
 *
 * These lists are JSON arrays, and the `jsonArray` decoder (db/schema.ts) guarantees the array,
 * not what is in it. A row from another client's build may hold a number or a `null` (#31's review
 * focus 1), or a blank string, which passes a string check and is still no word: it read as `''`,
 * leaving a trailing separator, an empty labelled row or a tile with no word (#69). Each is
 * skipped. A word with spaces around it is that word, so a known token stays known (` boat` is
 * *Boat*, with its drawing). A word this build does not know is kept (§10's store-and-flag), so the
 * members are plain strings and each reader decides what its vocabulary makes of them.
 *
 * **The one guard for every stored list a diver reads**: a place's sets (`formatPlaceTokens`), the
 * site page's tiles, the prefill's ways in (`siteDefaultValue`, so the page and the prefill count
 * the same set), a dive's equipment on its page (`formatEquipment`) and in the CSV export, and a
 * place's other names (`altNamesIn`). There were four copies, and they had drifted: #68 taught
 * the equipment's to skip blanks and the places' two did not learn it. It lives in `domain/`, not
 * `format/`, so a reader that is not a screen reaches it without importing the display layer.
 */
export function wordsOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return (list as readonly unknown[]).flatMap((member) => {
    const word = typeof member === 'string' ? member.trim() : '';
    return word === '' ? [] : [word];
  });
}
