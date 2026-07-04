// useJobShortcuts — keyboard Start / Stop (M22, WORKFLOW F-A15 Phase B+).
//
//   Ctrl/Cmd+Return  → Start job (same flow as the Start button)
//   Ctrl/Cmd+.       → Stop job
//
// Stop is the panic path: it intentionally IGNORES the modal-open and
// editable-target gates the other shortcuts honor — PROJECT.md
// non-negotiable #9 says the stop must be reachable from any window state,
// and a panic happens mid-typing as easily as mid-click. Start respects
// the modal gate (starting a burn from inside a dialog is never intended).

import { useEffect } from 'react';
import { isEditableShortcutTarget } from '../common/keyboard-targets';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { isModalOpen, useUiStore } from '../state/ui-store';
import { runStartJobFlow } from './start-job-flow';

export function installJobShortcuts(target: Window): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === '.') {
      handleStopShortcut(e);
      return;
    }
    if (e.key === 'Enter') {
      if (isModalOpen(useUiStore.getState())) return;
      if (isEditableShortcutTarget(e.target)) return;
      const laser = useLaserStore.getState();
      if (laser.connection.kind !== 'connected' || isActiveJob(laser.streamer)) return;
      e.preventDefault();
      void runStartJobFlow();
    }
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}

export function useJobShortcuts(): void {
  useEffect(() => installJobShortcuts(window), []);
}

function handleStopShortcut(e: KeyboardEvent): void {
  const laser = useLaserStore.getState();
  const activeJob = isActiveJob(laser.streamer);
  const activeMotion = laser.motionOperation !== null;
  if (!activeJob && !activeMotion) return;
  e.preventDefault();
  void (activeJob ? laser.stopJob() : laser.cancelJog()).catch(() => undefined);
}
