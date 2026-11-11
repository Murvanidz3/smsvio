export function showing(total: number, page: number, pageSize: number): string {
  if (total === 0) {
    return 'Showing 0 of 0';
  }
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return `Showing ${String(start)}–${String(end)} of ${String(total)}`;
}

export function PageSize({ value, onChange }: { value: number; onChange: (size: number) => void }) {
  return (
    <label className="text-sm">
      Page size
      <select
        className="border-input ml-2 h-9 rounded-lg border px-2"
        value={value}
        onChange={(event) => {
          onChange(Number(event.target.value));
        }}
      >
        {[10, 25, 50, 100].map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Pager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        className="hover:bg-muted h-8 rounded-lg px-3 text-sm disabled:opacity-40"
        disabled={page <= 1}
        onClick={() => {
          onPage(page - 1);
        }}
      >
        Previous
      </button>
      <span className="text-muted-foreground text-sm">
        {page} / {pages}
      </span>
      <button
        type="button"
        className="hover:bg-muted h-8 rounded-lg px-3 text-sm disabled:opacity-40"
        disabled={page >= pages}
        onClick={() => {
          onPage(page + 1);
        }}
      >
        Next
      </button>
    </div>
  );
}

export function flag(iso2: string): string {
  const country = iso2.toUpperCase();
  let symbols = '';
  for (let index = 0; index < country.length; index += 1) {
    symbols += String.fromCodePoint(127397 + country.charCodeAt(index));
  }
  return symbols;
}
