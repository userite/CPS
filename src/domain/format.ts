/** Plant timezone is not decided. Times render in the browser's local zone. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("bg-BG", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 1 }).format(value);
}

function counted(value: number, one: string, other: string): string {
  return value === 1 ? one : other;
}

export function formatUpdatedAgo(iso: string, now: Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "Неизвестно време на обновяване";
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (seconds < 1) return "Току-що";
  if (seconds < 60) {
    return `Преди ${seconds} ${counted(seconds, "секунда", "секунди")}`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `Преди ${minutes} ${counted(minutes, "минута", "минути")}`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `Преди ${hours} ${counted(hours, "час", "часа")}`;
  }
  const days = Math.floor(hours / 24);
  return `Преди ${days} ${counted(days, "ден", "дни")}`;
}

export function metricCaption(label: string, unit: string): string {
  const name = label.trim() || "Характеристика";
  const trimmedUnit = unit.trim();
  return trimmedUnit ? `${name} (${trimmedUnit})` : name;
}
