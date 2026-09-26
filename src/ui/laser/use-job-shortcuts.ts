// useJobShortcuts — keyboard Start / software Abort (M22, WORKFLOW F-A15 Phase B+).
//
//   Ctrl/Cmd+Return  → Start job (same flow as the Start button)
//   Ctrl/Cmd+.       → Request the controller-specific Abort
//
// Abort intentionally IGNORES the modal-open and
// editable-target gates the other shortcuts honor — PROJECT.md
// non-negotiable #9 says Abort must be reachable from any window state,
// and a panic happens mid-typing as easily as mid-click. Start respects
// the modal gate (starting a burn from inside a dialog is never intended).

import { useEffect } from 'react';
import { isEditableShortcutTarget } from '../common/keyboard-targets';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { isModalOpen, useUiStore } from '../state/ui-store';
import { runStartJobFlow } from './start-job-flow';
import { controllerActionFailureHandler } from './report-controller-action-failure';

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
  const action = stopShortcutAction(useLaserStore.getState());
  if (action === null) return;
  e.preventDefault();
  void action.run().catch(controllerActionFailureHandler(action.label));
}

type LaserSnapshot = ReturnType<typeof useLaserStore.getState>;

// Same precedence as the Live Motion bar (LiveMotionBar describeLiveMotion):
// the keyboard Abort must stop whatever the bar offers ABORT or LASER OFF for.
// It used to act only on a streaming job or a jog/Frame, so during Home,
// Probe, Auto-focus, Start arming or with momentary Fire latched on, Ctrl+.
// silently did nothing (audit job-lifecycle-6 / ui-panel-4). Jog and Frame
// keep the gentler jog-cancel where the firmware has one; without it (Marlin,
// Smoothieware, the Falcon contract) cancelJog writes nothing, so Ctrl+. sends
// the same Abort as the bar's ABORT MOTION (controller audit 2026-09-25 CG-12).
function stopShortcutAction(
  laser: LaserSnapshot,
): { readonly label: string; readonly run: () => Promise<void> } | null {
  if (isActiveJob(laser.streamer)) return { label: 'Abort', run: () => laser.stopJob() };
  if (laser.controllerOperation !== null) {
    return { label: 'Abort motion', run: () => laser.stopJob() };
  }
  if (laser.motionOperation !== null) {
    return laser.capabilities.jogCancel
      ? { label: 'Stop motion', run: () => laser.cancelJog() }
      : { label: 'Abort motion', run: () => laser.stopJob() };
  }
  if (laser.fireActive) return { label: 'Laser off', run: () => laser.setFireActive(false) };
  return null;
}
