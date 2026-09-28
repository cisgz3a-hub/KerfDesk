// Open state of the Settings window (LightBurn gap LBG-F18). A store rather
// than CommandShell state so Ctrl/Cmd+, can open it from the key handler, and
// so a later reopen returns to the section last viewed this session.

import { create } from 'zustand';

export type SettingsSectionId = 'general' | 'canvas' | 'labs' | 'machine';

type SettingsDialogState = {
  readonly open: boolean;
  readonly section: SettingsSectionId;
  readonly openSettings: (section?: SettingsSectionId) => void;
  readonly setSection: (section: SettingsSectionId) => void;
  readonly closeSettings: () => void;
};

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  open: false,
  section: 'general',
  openSettings: (section) => set((state) => ({ open: true, section: section ?? state.section })),
  setSection: (section) => set({ section }),
  closeSettings: () => set({ open: false }),
}));

export function openSettings(section?: SettingsSectionId): void {
  useSettingsDialogStore.getState().openSettings(section);
}
