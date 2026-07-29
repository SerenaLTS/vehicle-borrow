const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: unknown) {
  const rawCell = String(value ?? "");
  const safeCell = CSV_FORMULA_PREFIX.test(rawCell) ? `'${rawCell}` : rawCell;

  return `"${safeCell.replaceAll('"', '""')}"`;
}
