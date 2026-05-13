// Feature-flag layer. Flags are read once at app start (page refresh
// required to apply changes) and persist in localStorage. Used to gate
// Phase-2 work (UI generation) from the Phase-1 default (PRD-only).

export type FeatureFlags = {
  uiGeneration: boolean
}

const STORAGE_KEY = "fabric_feature_flags"

const DEFAULT_FLAGS: FeatureFlags = {
  uiGeneration: false,
}

function loadFlags(): FeatureFlags {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<FeatureFlags>
      return { ...DEFAULT_FLAGS, ...parsed }
    }
  } catch {
    // localStorage not available or JSON malformed — fall through.
  }
  return DEFAULT_FLAGS
}

export function getFeatures(): FeatureFlags {
  return loadFlags()
}

export function setFeature<K extends keyof FeatureFlags>(
  key: K,
  value: FeatureFlags[K],
): void {
  const current = loadFlags()
  const updated = { ...current, [key]: value }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  } catch {
    // Persistence failed — the in-memory change is still lost on reload,
    // but the toggle UI will surface this via a stale-state on next read.
  }
}

export function isUiGenerationEnabled(): boolean {
  return getFeatures().uiGeneration
}
