// Snap settings persistence (LightBurn gap LBG-F06). Snapping is an app
// preference, kept per browser like the canvas start-marker toggle — never in
// the project file, so it neither travels with a shared project nor bumps the
// project schema.

import {
  DEFAULT_SNAP_SETTINGS,
  normalizeSnapSettings,
  type SnapSettings,
} from '../workspace/snap-settings';
import { browserLocalStorage } from './browser-local-storage';

export const SNAP_SETTINGS_KEY = 'laserforge.snap-settings.v1';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readSnapSettings(
  storage: PreferenceStorage | null = browserLocalStorage(),
): SnapSettings {
  try {
    const stored = storage?.getItem(SNAP_SETTINGS_KEY);
    if (stored === null || stored === undefined) return DEFAULT_SNAP_SETTINGS;
    return normalizeSnapSettings(JSON.parse(stored));
  } catch {
    return DEFAULT_SNAP_SETTINGS;
  }
}

export function writeSnapSettings(
  settings: SnapSettings,
  storage: PreferenceStorage | null = browserLocalStorage(),
): void {
  try {
    storage?.setItem(SNAP_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage is optional; the in-memory preference still applies this session.
  }
}
