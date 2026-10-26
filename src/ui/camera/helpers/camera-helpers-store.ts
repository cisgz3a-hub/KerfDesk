// The camera helpers' on/off switches (ADR-663 Amendment 1), kept on this
// computer like the rest of the camera preferences, in a store so the settings
// page and the helpers read the same value.

import { create } from 'zustand';
import {
  loadCameraHelpers,
  saveCameraHelpers,
  type CameraHelperSettings,
} from '../../state/camera-preference-storage';

type CameraHelpersStore = {
  readonly settings: CameraHelperSettings;
  readonly setSettings: (patch: Partial<CameraHelperSettings>) => void;
};

export const useCameraHelpersStore = create<CameraHelpersStore>((set) => ({
  settings: loadCameraHelpers(),
  setSettings: (patch) =>
    set((state) => {
      const settings = { ...state.settings, ...patch };
      saveCameraHelpers(settings);
      return { settings };
    }),
}));
