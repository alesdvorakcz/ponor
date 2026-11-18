/**
 * Options split into rows of `columns`, the last row padded with `null` so every tile in the grid
 * is the same width (issue #6). One owner for the form's tiles (`ChoiceGrid`, under `OptionChips`
 * and `TokenChips`) and the dive detail's (`ConditionTiles`), which lay their tiles out alike.
 */
export function tileRows<T>(options: readonly T[], columns: number): (T | null)[][] {
  const rows: (T | null)[][] = [];
  for (let start = 0; start < options.length; start += columns) {
    const row: (T | null)[] = options.slice(start, start + columns);
    while (row.length < columns) row.push(null);
    rows.push(row);
  }
  return rows;
}
