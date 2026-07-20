export type DensityMode = "compact" | "standard" | "comfortable";

export interface UserPreferences {
  density: DensityMode;
  activeView: "live" | "rollover" | "all";
  savedFilters: Record<string, string>;
  sortColumn: string;
  sortDirection: "asc" | "desc";
  kpiFilter: string | null;
}

const PREFS_KEY = "cesanek_prefs";

const defaults: UserPreferences = {
  density: "standard",
  activeView: "live",
  savedFilters: {},
  sortColumn: "appointmentTime",
  sortDirection: "asc",
  kpiFilter: null,
};

export function loadPreferences(): UserPreferences {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

export function savePreferences(prefs: Partial<UserPreferences>): void {
  if (typeof window === "undefined") return;
  const current = loadPreferences();
  const merged = { ...current, ...prefs };
  localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
}
