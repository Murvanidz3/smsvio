export const MAX_CSV_ROWS = 5_000;

export type CsvResult =
  | { readonly ok: true; readonly rows: readonly (readonly string[])[] }
  | { readonly ok: false; readonly message: string };

/** RFC 4180-style parser. A trailing newline does not create an extra row. */
export function parseCsv(input: string): CsvResult {
  const text = input
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  if (text.trim() === '') {
    return { ok: true, rows: [] };
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += char;
  }
  if (quoted) {
    return { ok: false, message: 'A quoted value was left open.' };
  }
  if (row.length > 0 || field !== '' || !text.endsWith('\n')) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length > MAX_CSV_ROWS) {
    return {
      ok: false,
      message: `A contact import can contain at most ${String(MAX_CSV_ROWS)} rows.`,
    };
  }
  return { ok: true, rows };
}
