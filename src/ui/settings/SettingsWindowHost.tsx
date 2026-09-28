// Mounts the Settings window while Edit → Settings or Ctrl/Cmd+, has it open.

import { SettingsDialog } from './SettingsDialog';
import { useSettingsDialogStore } from './settings-dialog-store';

export function SettingsWindowHost(): JSX.Element | null {
  const open = useSettingsDialogStore((state) => state.open);
  const close = useSettingsDialogStore((state) => state.closeSettings);
  return open ? <SettingsDialog onClose={close} /> : null;
}
