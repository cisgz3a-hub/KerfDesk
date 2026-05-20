/**
 * T1-204: UI feature flags, persisted to localStorage.
 *
 * Used initially for the `WorkflowPanel` rollout — the new
 * connection-panel design (`docs/CONNECTION-PANEL-REDESIGN.md`)
 * ships behind `workflowPanelV2`, default off. Once parity with the
 * existing `ConnectionPanelMain` is confirmed by the user, the flag
 * flips to default-on and the old panel is deleted.
 *
 * Why localStorage and not a runtime config: feature flags belong in
 * the same storage layer as the user's other UI preferences (panel
 * widths, active profile, autosave state). A future Settings UI can
 * read / write these via the same accessors without coupling to the
 * env-var / build pipeline.
 *
 * NOT for safety-critical gates. Anything that affects machine
 * commands, gcode emission, or job validation must NOT be flag-
 * gated — the audit ledger has explicit guidance about not adding
 * "soft" overrides to safety paths. UI cosmetic / layout flags only.
 */
const STORAGE_KEY_PREFIX = 'laserforge.feature.';

/**
 * Declared UI feature flags. Each flag has a literal name and a
 * default value used when localStorage has no entry yet (fresh
 * install) OR when localStorage isn't available (non-browser test
 * environments).
 */
export interface UiFeatureFlags {
  /**
   * When true, `ConnectionPanel` routes to the new `WorkflowPanel`
   * (three-zone, mode-driven layout). When false, the existing
   * `ConnectionPanelMain` renders. Default false during the rollout
   * (Phases 1–5 of the redesign).
   */
  readonly workflowPanelV2: boolean;
}

const DEFAULTS: UiFeatureFlags = {
  workflowPanelV2: false,
};

type FlagName = keyof UiFeatureFlags;

/**
 * F45-14-001: WorkflowPanel v2 is not machine-control parity-safe yet.
 * Keep storage round-tripping so developer/test preferences are not
 * destroyed, but force the effective beta value off until a later
 * audited change lifts the lock after parity with ConnectionPanelMain.
 */
const EFFECTIVE_FLAG_LOCKS: Partial<Record<FlagName, boolean>> = {
  workflowPanelV2: false,
};

function storageKey(name: FlagName): string {
  return STORAGE_KEY_PREFIX + name;
}

function readBoolean(name: FlagName): boolean {
  const locked = EFFECTIVE_FLAG_LOCKS[name];
  if (typeof locked === 'boolean') return locked;
  if (typeof localStorage === 'undefined') return DEFAULTS[name];
  const raw = localStorage.getItem(storageKey(name));
  if (raw === null) return DEFAULTS[name];
  // Be liberal in what we accept — older builds may have written
  // 'true' / 'false' / '1' / '0'.
  return raw === 'true' || raw === '1';
}

function writeBoolean(name: FlagName, value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(storageKey(name), value ? 'true' : 'false');
}

/** Read the current value of a UI feature flag. */
export function getUiFeatureFlag(name: FlagName): boolean {
  return readBoolean(name);
}

/** Set a UI feature flag and persist to localStorage. */
export function setUiFeatureFlag(name: FlagName, value: boolean): void {
  writeBoolean(name, value);
  // Mirror the active-profile-changed pattern: dispatch a synthetic
  // event so listeners (e.g. ConnectionPanel) can re-render without
  // polling. Wrapped in try/catch for non-DOM test environments.
  try {
    window.dispatchEvent(new Event('laserforge:ui-feature-flag-changed'));
  } catch {
    /* non-DOM env */
  }
}

/**
 * Read all flags as a frozen snapshot. Useful for top-level routing
 * components that need to render based on multiple flags at once
 * without subscribing to each.
 */
export function getAllUiFeatureFlags(): UiFeatureFlags {
  return Object.freeze({
    workflowPanelV2: readBoolean('workflowPanelV2'),
  });
}

/** Storage-key prefix exposed for test setup / teardown. */
export const UI_FEATURE_FLAG_STORAGE_PREFIX = STORAGE_KEY_PREFIX;

/** Event name dispatched when any flag changes via setUiFeatureFlag. */
export const UI_FEATURE_FLAG_CHANGED_EVENT = 'laserforge:ui-feature-flag-changed';
