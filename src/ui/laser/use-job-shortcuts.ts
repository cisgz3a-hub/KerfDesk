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
//
// Abort listens in the window's capture phase, which runs before any
// element's own handler. The canvas text editor, Image Studio's dialogs and
// the desktop Editors panel stop every keydown they get, so a bubble listener
// never heard Ctrl+. from them, and the modal ones trap Tab too (audit
// 27-P2-1). The app mounts Abort apart from Start, outside the workspace's
// error boundary, so it also outlives a render crash (27-P2-2).

import { useEffect } from 'react';
import { machineKindOf } from '../../core/scene';
import { isEditableShortcutTarget } from '../common/keyboard-targets';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { unownedControllerMotion } from '../state/unowned-controller-motion';
import { turnUnownedOutputOff, unownedControllerOutput } from '../state/unowned-controller-output';
import { useStore } from '../state';
import { isModalOpen, useUiStore } from '../state/ui-store';
import { runStartJobFlow } from './start-job-flow';
import { controllerActionFailureHandler } from './report-controller-action-failure';

export function installJobShortcuts(target: Window): () => void {
  const removeAbort = installAbortShortcut(target);
  const removeStart = installStartShortcut(target);
  return () => {
    removeStart();
    removeAbort();
  };
}

export function installAbortShortcut(target: Window): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key !== '.') return;
    handleStopShortcut(e);
  };
  target.addEventListener('keydown', onKeyDown, true);
  return () => target.removeEventListener('keydown', onKeyDown, true);
}

export function installStartShortcut(target: Window): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key !== 'Enter') return;
    if (isModalOpen(useUiStore.getState())) return;
    if (isEditableShortcutTarget(e.target)) return;
    const laser = useLaserStore.getState();
    if (laser.connection.kind !== 'connected' || isActiveJob(laser.streamer)) return;
    e.preventDefault();
    void runStartJobFlow();
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}

export function useJobShortcuts(): void {
  useEffect(() => installJobShortcuts(window), []);
}

export function useAbortShortcut(): void {
  useEffect(() => installAbortShortcut(window), []);
}

export function useStartShortcut(): void {
  useEffect(() => installStartShortcut(window), []);
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
  // Motion the controller reports and nothing here owns (a Console G1, $J= or
  // $H): the bar's ABORT MOTION, which picks the stop for its state (ADR-375 C-2).
  if (unownedControllerMotion(laser) !== null) {
    return { label: 'Abort motion', run: () => laser.stopJob() };
  }
  // A laser the controller reports on at Idle, with nothing here running it:
  // the bar's LASER OFF, M5 with no reset (rolling audit v5 J2-P2-1).
  const machineKind = machineKindOf(useStore.getState().project.machine);
  if (unownedControllerOutput(laser, machineKind) !== null) {
    return { label: 'Laser off', run: () => turnUnownedOutputOff(laser, machineKind) };
  }
  return null;
}
