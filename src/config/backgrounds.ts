/** Preset backgrounds for the табло — selectable in the UI, stored in localStorage. */

export const tabloBackgroundStorageKey = "cps.tabloBackground";

export const tabloBackgroundIds = ["slate", "steel", "graphite", "shop", "noir", "day"] as const;

export type TabloBackgroundId = (typeof tabloBackgroundIds)[number];

/** Default is a clear non-black look so the screen is not stuck on near-black. */
export const tabloBackgroundDefault: TabloBackgroundId = "slate";

export const tabloBackgroundChoices: ReadonlyArray<{ id: TabloBackgroundId; label: string }> = [
  { id: "slate", label: "Стоманено сиво" },
  { id: "steel", label: "Синя стомана" },
  { id: "graphite", label: "Графит" },
  { id: "shop", label: "Цех (топло)" },
  { id: "noir", label: "Тъмно (оригинал)" },
  { id: "day", label: "Дневно светло" },
];

export function normalizeTabloBackground(value: unknown): TabloBackgroundId {
  if (typeof value === "string" && (tabloBackgroundIds as readonly string[]).includes(value)) {
    return value as TabloBackgroundId;
  }
  return tabloBackgroundDefault;
}

export function applyTabloBackground(id: TabloBackgroundId): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.tabloBg = normalizeTabloBackground(id);
}

export function readStoredTabloBackground(): TabloBackgroundId {
  try {
    return normalizeTabloBackground(window.localStorage.getItem(tabloBackgroundStorageKey));
  } catch {
    return tabloBackgroundDefault;
  }
}

export function writeStoredTabloBackground(id: TabloBackgroundId): void {
  try {
    window.localStorage.setItem(tabloBackgroundStorageKey, normalizeTabloBackground(id));
  } catch {
    /* ignore quota / private mode */
  }
}
