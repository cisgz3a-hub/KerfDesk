import { useEffect, useState } from 'react';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';

export type CutSettingsLauncher = {
  readonly settingsOpen: boolean;
  readonly cutSettingsBlocked: boolean;
  readonly openSettings: () => void;
  readonly closeSettings: () => void;
};

export function useCutSettingsLauncher(): CutSettingsLauncher {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const cutSettingsBlocked = useLaserStore(
    (s) => isActiveJob(s.streamer) || s.motionOperation !== null || s.autofocusBusy,
  );
  useEffect(() => {
    if (settingsOpen && cutSettingsBlocked) setSettingsOpen(false);
  }, [cutSettingsBlocked, settingsOpen]);
  return {
    settingsOpen,
    cutSettingsBlocked,
    openSettings: () => {
      if (!cutSettingsBlocked) setSettingsOpen(true);
    },
    closeSettings: () => setSettingsOpen(false),
  };
}
