export function MachineIcon({ kind }: { kind?: "lathe" | "other" }) {
  if (kind === "lathe") {
    return (
      <span className="mc-icon" aria-hidden="true">
        <svg viewBox="0 0 32 32">
          <rect x="3" y="20" width="26" height="6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <rect x="4" y="11" width="8" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="15" cy="16" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M18 16h10" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </span>
    );
  }

  return (
    <span className="mc-icon" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <rect x="5" y="6" width="22" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M5 12h22M12 12v14" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    </span>
  );
}
