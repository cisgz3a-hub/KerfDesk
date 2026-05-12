/**
 * T1-204: top-level `WorkflowPanel` — the new connection-panel
 * design (`docs/CONNECTION-PANEL-REDESIGN.md`).
 *
 * Phase 1 scope: scaffold only. Three zones (TopBar, Mode content,
 * PrimaryActionFooter) and a state-machine that picks the active
 * mode via the pure `derivePanelMode` helper. Mode bodies are
 * stubs that render a "Phase N will fill this in" placeholder so
 * the routing is verifiable end-to-end without any of the real
 * mode implementations being ready.
 *
 * The panel renders only when the `workflowPanelV2` UI feature flag
 * is true. The flag defaults off; `ConnectionPanel.tsx` (the outer
 * wrapper) reads the flag and chooses between the existing
 * `ConnectionPanelMain` and this new component. The old panel
 * keeps working until parity is confirmed.
 *
 * Phase 2+ replace each `ModeStub` import with a real mode
 * component, wire `PrimaryActionFooter` action handlers to
 * MachineService / ExecutionCoordinator, and stop being a no-op
 * for safety-critical interactions.
 */
import React from 'react';
import type { MachineState, MachineStatus } from '../../../controllers/ControllerInterface';
import type { RecoveryState } from '../../../runtime/RecoveryState';
import { derivePanelMode, type PanelMode } from './derivePanelMode';
import { TopBar } from './zones/TopBar';
import {
  PrimaryActionFooter,
  type PrimaryActionDescriptor,
  type SecondaryActionDescriptor,
} from './zones/PrimaryActionFooter';
import { ModeStub } from './modes/ModeStub';

const FONT = "'DM Sans', system-ui, sans-serif";

export interface WorkflowPanelProps {
  readonly machineState: MachineState | null;
  readonly machineStatus: MachineStatus | null;
  readonly isConnected: boolean;
  readonly isConnecting: boolean;
  readonly recoveryState: RecoveryState;
  readonly canStartJob: boolean;
  /**
   * Optional handlers. Phase 1 passes them through to the footer /
   * top bar but the stub modes don't fire them. Phase 2 wires them
   * to MachineService / ExecutionCoordinator.
   *
   * Each handler is nullable — when null, the corresponding button
   * is rendered disabled. This lets the panel render without
   * machine plumbing during testing.
   */
  readonly onEmergencyStop: (() => void) | null;
  readonly onConnectUsb: (() => void) | null;
  readonly onConnectSimulator: (() => void) | null;
  readonly onCancelConnect: (() => void) | null;
  readonly onStartJob: (() => void) | null;
  readonly onPause: (() => void) | null;
  readonly onResume: (() => void) | null;
  readonly onStop: (() => void) | null;
}

/**
 * Pick the primary / secondary action descriptors for a mode.
 * Extracted out of the component body so the mapping is testable
 * in isolation and so each mode's action wiring stays in one place
 * (rather than scattered across mode components).
 */
export function pickActions(
  mode: PanelMode,
  props: WorkflowPanelProps,
): {
  primary: PrimaryActionDescriptor;
  secondaries: ReadonlyArray<SecondaryActionDescriptor>;
} {
  switch (mode) {
    case 'disconnected':
      return {
        primary: { label: 'Connect USB', variant: 'primary', onClick: props.onConnectUsb },
        secondaries: [
          { label: 'Simulator', onClick: props.onConnectSimulator },
        ],
      };
    case 'connecting':
      return {
        primary: { label: 'Connecting…', variant: 'disabled', onClick: null },
        secondaries: [
          { label: 'Cancel', onClick: props.onCancelConnect },
        ],
      };
    case 'recovery':
      // Recovery mode's Acknowledge / Unlock button lives inside the
      // mode body (handled by the RecoveryCard in Phase 2) so the
      // footer's primary is intentionally a no-op placeholder. Hard
      // lock per the user's design decision: no other action
      // reachable from the footer while in recovery.
      return {
        primary: { label: 'Acknowledge recovery in the card above', variant: 'disabled', onClick: null },
        secondaries: [],
      };
    case 'setup':
      // Phase 2+ will replace this with the actual blocking-gate
      // label from buildStartReadiness. For Phase 1 the placeholder
      // is honest: setup mode has no single primary action.
      return {
        primary: { label: 'Frame & compile before starting', variant: 'disabled', onClick: null },
        secondaries: [],
      };
    case 'ready':
      return {
        primary: { label: 'Start Job', variant: 'success', onClick: props.onStartJob },
        secondaries: [],
      };
    case 'running':
      return {
        primary: { label: 'Pause', variant: 'primary', onClick: props.onPause },
        secondaries: [
          { label: 'Stop', onClick: props.onStop },
        ],
      };
    case 'paused':
      return {
        primary: { label: 'Resume', variant: 'success', onClick: props.onResume },
        secondaries: [
          { label: 'Stop', onClick: props.onStop },
        ],
      };
  }
}

/**
 * Pick the phase number a given mode is scheduled for, used by the
 * Phase-1 `ModeStub` placeholder so the message tells the user
 * which redesign phase will replace each stub.
 *
 * disconnected / connecting / recovery → Phase 2 (simplest first)
 * setup → Phase 3 (tabs come later because of three sub-views)
 * ready / running / paused → Phase 4
 */
export function modeImplementationPhase(mode: PanelMode): number {
  switch (mode) {
    case 'disconnected':
    case 'connecting':
    case 'recovery':
      return 2;
    case 'setup':
      return 3;
    case 'ready':
    case 'running':
    case 'paused':
      return 4;
  }
}

export function WorkflowPanel(props: WorkflowPanelProps): React.ReactElement {
  const mode = derivePanelMode({
    isConnected: props.isConnected,
    isConnecting: props.isConnecting,
    machineStatus: props.machineStatus,
    recoveryState: props.recoveryState,
    canStartJob: props.canStartJob,
  });

  const actions = pickActions(mode, props);

  return React.createElement(
    'div',
    {
      'data-testid': 'workflow-panel',
      'data-mode': mode,
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#0a0a14',
        color: '#e5e7eb',
        fontFamily: FONT,
        overflow: 'hidden',
        minHeight: 0,
      },
    },
    // Zone 1: Top bar (always visible)
    React.createElement(TopBar, {
      mode,
      machineState: props.machineState,
      isConnected: props.isConnected,
      onEmergencyStop: props.onEmergencyStop ?? (() => {}),
    }),
    // Zone 2: Mode content (scrolls inside)
    React.createElement(
      'div',
      {
        'data-testid': 'workflow-mode-content',
        'data-mode': mode,
        style: {
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        },
      },
      React.createElement(ModeStub, {
        mode,
        phase: modeImplementationPhase(mode),
      }),
    ),
    // Zone 3: Primary action footer (always visible)
    React.createElement(PrimaryActionFooter, {
      mode,
      primary: actions.primary,
      secondaries: actions.secondaries,
    }),
  );
}
