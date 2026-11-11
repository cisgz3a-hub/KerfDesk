import { useState } from 'react';

export type CutSettingsLauncher = {
  readonly settingsOpen: boolean;
  readonly openSettings: () => void;
  readonly closeSettings: () => void;
};

// Cut Settings opens whatever the machine is doing. It used to be greyed out
// during a job, jog, Frame or autofocus, with no reason shown, and an open
// dialog was closed and its draft dropped when motion began (annoyance audit
// A4-P2-7). No safety reason held (ADR-706): the fields beside the button edit
// the same operation throughout, a running job streams the program it was
// started with, Abort ignores an open dialog and the Live Motion bar sits above
// it, and every other way into the same dialog was never blocked.
export function useCutSettingsLauncher(): CutSettingsLauncher {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return {
    settingsOpen,
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
  };
}
