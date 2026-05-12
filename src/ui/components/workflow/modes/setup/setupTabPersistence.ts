/**
 * T1-207 (Phase 3): localStorage persistence for the active tab in
 * the WorkflowPanel's `setup` mode.
 *
 * Tab state survives reload. The user's design decision (from the
 * brainstorm in `docs/CONNECTION-PANEL-REDESIGN.md`): tabs persist
 * so the user isn't bounced back to Move every time they switch
 * windows / reload the renderer.
 *
 * The storage key is namespaced separately from the UI feature
 * flags (`laserforge.ui.setup-tab`) so a future "reset all UI
 * preferences" path can wipe these without touching feature flags.
 */
export type SetupTab = 'move' | 'job' | 'console';

export const ALL_SETUP_TABS: ReadonlyArray<SetupTab> = ['move', 'job', 'console'];

const STORAGE_KEY = 'laserforge.ui.setup-tab';
const DEFAULT_TAB: SetupTab = 'move';

function isSetupTab(value: unknown): value is SetupTab {
  return value === 'move' || value === 'job' || value === 'console';
}

export function readSetupTab(): SetupTab {
  if (typeof localStorage === 'undefined') return DEFAULT_TAB;
  const raw = localStorage.getItem(STORAGE_KEY);
  return isSetupTab(raw) ? raw : DEFAULT_TAB;
}

export function writeSetupTab(tab: SetupTab): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, tab);
}

export const SETUP_TAB_STORAGE_KEY = STORAGE_KEY;
export const SETUP_TAB_DEFAULT: SetupTab = DEFAULT_TAB;
