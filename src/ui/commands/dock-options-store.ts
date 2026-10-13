// The Docking options (LightBurn Docking toolbar): padding, Move as group and
// Lock inner objects. A workstation preference kept in local storage, like
// the image presets; the Dock commands read it when they run.

import { create } from 'zustand';
import type { DockOptions } from '../../core/scene/selection-dock';

export type DockSettings = Omit<DockOptions, 'direction'>;

const KEY = 'lf2:dock-options:v1';
const DEFAULTS: DockSettings = { paddingMm: 0, moveAsGroup: false, lockInner: false };

type DockOptionsState = {
  readonly settings: DockSettings;
  readonly dialogOpen: boolean;
  readonly setSettings: (settings: DockSettings) => void;
  readonly openDialog: () => void;
  readonly closeDialog: () => void;
};

export const useDockOptionsStore = create<DockOptionsState>((set) => ({
  settings: readSettings(),
  dialogOpen: false,
  setSettings: (settings) => {
    writeSettings(settings);
    set({ settings });
  },
  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
}));

function readSettings(): DockSettings {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULTS;
    const record = parsed as Record<string, unknown>;
    const padding = record['paddingMm'];
    return {
      paddingMm:
        typeof padding === 'number' && Number.isFinite(padding) && padding >= 0 ? padding : 0,
      moveAsGroup: record['moveAsGroup'] === true,
      lockInner: record['lockInner'] === true,
    };
  } catch {
    return DEFAULTS;
  }
}

function writeSettings(settings: DockSettings): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable; the options still apply for this session.
  }
}
