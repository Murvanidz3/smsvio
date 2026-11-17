export function Mark({ className = 'mkt-mark' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#111827" />
      <path
        d="M9.5 8h13A3.5 3.5 0 0 1 26 11.5v7a3.5 3.5 0 0 1-3.5 3.5H15l-5 4v-4h-.5A3.5 3.5 0 0 1 6 18.5v-7A3.5 3.5 0 0 1 9.5 8Z"
        fill="#ffffff"
      />
      <path
        d="m11.75 12.25 4.25 5.5 4.25-5.5"
        fill="none"
        stroke="#111827"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="mkt-word">
      SMS<span className="mkt-vio">VIO</span>
    </span>
  );
}
