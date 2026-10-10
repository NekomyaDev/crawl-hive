export function Logo({ size = 28 }: { size?: number }) {
  // Шестигранник-соту с «точкой» внутри: краулер в улье.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <path d="M16 2 28 9v14l-12 7-12-7V9z" fill="none" stroke="var(--honey)" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M16 9.5 22 13v6.5L16 23l-6-3.5V13z" fill="var(--honey)" opacity=".2" />
      <circle cx="16" cy="16.2" r="3" fill="var(--honey)" />
    </svg>
  );
}
