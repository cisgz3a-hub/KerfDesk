/**
 * T1-129: pure data-assembly helper for the start-readiness panel.
 * Extracted from a 142-line IIFE inside ConnectionPanelMain.tsx as
 * the first ConnectionPanelMain decomposition slice (audit Sprint
 * 7 + Sprint 4 #1 — split GRBL UI from ConnectionPanelMain;
 * starting with pure helpers per the audit's "extract pure display
 * components first" guidance).
 *
 * The helper builds the per-gate readiness rows (controller
 * connected, G-code compiled, G-code fresh, preflight, machine
 * idle, frame controls available, framing complete, current-mode
 * frame anchor valid, laser-safety state known, WCS confirmed,
 * connection trust) and selects the first failing gate as the
 * blocking gate. No React state, no side effects — pre-T1-129
 * the IIFE was already pure; this just gives it a typed entry
 * point so the assembly logic is testable in isolation.
 *
 * Wider future use: the same readiness shape is consumed by
 * StartReadinessPanel for UI rendering. A future second-controller
 * UI surface (Sprint 4 #3 simulator/file controller) can build the
 * same gates without inheriting from ConnectionPanelMain.
 */
import type { ActiveOperationState, LaserOutputState } from '../../../app/MachineService';
import type { MachineState, MachineStatus } from '../../../controllers/ControllerInterface';
import type { GcodeStartMode } from '../../../core/output/GcodeOrigin';
import type { PreflightSummary } from '../../../core/preflight/Preflight';
import type { TrustClassification } from '../../../security/FalconWiFiTrust';
import type { StartReadiness, StartReadinessGate } from './StartReadinessPanel';

/**
 * Inputs for the readiness derivation. Snapshot at render time;
 * caller (ConnectionPanelMain) gathers these from refs / state /
 * props and passes them in. Anything ConnectionPanelMain reads
 * during the original IIFE is here verbatim.
 */
export interface BuildStartReadinessInput {
  readonly preflight: PreflightSummary | null;
  readonly isConnected: boolean;
  readonly machineState: MachineState | null;
  readonly machineStatus: MachineStatus | undefined;
  readonly laserOutputState: LaserOutputState;
  readonly activeOperation: ActiveOperationState | null;
  readonly recoveryPending: boolean;
  readonly gcode: string | null;
  readonly gcodeStale: boolean;
  readonly isSimulator: boolean;
  readonly machineBlocksJobStart: boolean;
  readonly canFrame: boolean;
  readonly requireFrame: boolean;
  readonly hasFramed: boolean;
  readonly startMode: GcodeStartMode;
  readonly currentModeFrameAnchorValid: boolean;
  readonly placementUncertain: boolean;
  readonly wifiTrust: TrustClassification;
  readonly wifiStartAllowed: boolean;
  readonly isRunning: boolean;
  readonly canStartJob: boolean;
}

/** Frame-control fail headline — computed inline pre-T1-129. */
function frameControlBlockedHeadline(input: BuildStartReadinessInput): string {
  if (!input.isConnected) return 'No controller connection';
  if (!input.machineState) return 'Waiting for controller state';
  if (input.laserOutputState === 'unknown') return 'Laser-safety state unknown';
  if (input.laserOutputState === 'on') return 'Laser output is still marked on';
  if (input.activeOperation != null) {
    return `Operation "${input.activeOperation.kind}" is still in progress`;
  }
  if (input.recoveryPending) return 'Previous job recovery is pending';
  if (input.machineState.errorCode != null) {
    return `Controller error ${input.machineState.errorCode}`;
  }
  if (input.machineStatus != null && input.machineStatus !== 'idle') {
    return `Machine is "${input.machineStatus}"`;
  }
  return 'Frame control is not available';
}

export function buildStartReadiness(input: BuildStartReadinessInput): StartReadiness {
  const blockerCount = input.preflight?.blockers ?? 0;
  const warningCount = input.preflight?.warnings ?? 0;
  const preflightDetails = (input.preflight?.issues ?? [])
    .filter((i) => i.severity === 'blocker' || i.severity === 'warning')
    .slice(0, 5)
    .map((i) => ({
      severity: i.severity as 'blocker' | 'warning',
      text: i.title,
    }));

  const gates: StartReadinessGate[] = [
    {
      id: 'controllerConnected',
      label: 'Controller connected',
      status: input.isConnected ? 'ok' : 'fail',
      failHeadline: 'No controller connection',
      failAction: 'Connect to the laser using the Connect button above',
    },
    {
      id: 'gcodeCompiled',
      label: 'G-code compiled',
      status: input.gcode ? 'ok' : 'fail',
      failHeadline: 'No G-code yet',
      failAction: 'Click G-code in the toolbar to compile this design',
    },
    {
      id: 'gcodeFresh',
      label: 'G-code matches current design',
      status: !input.gcode ? 'pending' : (input.gcodeStale ? 'fail' : 'ok'),
      failHeadline: 'Design changed since last compile',
      failAction: 'Click ↻ Update above to recompile',
    },
    {
      id: 'preflight',
      label: 'Design preflight checks',
      status:
        input.preflight == null
          ? 'pending'
          : input.preflight.canStart
            ? 'ok'
            : 'fail',
      failHeadline:
        blockerCount > 0
          ? `${blockerCount} blocker${blockerCount === 1 ? '' : 's'}${warningCount > 0 ? ` and ${warningCount} warning${warningCount === 1 ? '' : 's'}` : ''}`
          : 'Preflight blocked',
      failDetails: preflightDetails,
      failAction: 'Open the Issues panel above to see and fix each one',
    },
    {
      id: 'machineState',
      label: 'Machine idle',
      status:
        !input.isConnected || input.isSimulator
          ? 'pending'
          : input.machineBlocksJobStart
            ? 'fail'
            : 'ok',
      failHeadline: input.machineStatus
        ? `Machine is "${input.machineStatus}"`
        : 'Machine not in idle state',
      failAction: 'Wait for idle, or stop/reset on the controller if it is stuck',
    },
    {
      id: 'frameControls',
      label: 'Frame control available',
      status:
        !input.isConnected || !input.machineState
          ? 'pending'
          : input.canFrame
            ? 'ok'
            : 'fail',
      failHeadline: frameControlBlockedHeadline(input),
      failAction: 'Clear this machine/safety hold, then click Frame before Start',
    },
    {
      id: 'framing',
      label: 'Job framed',
      status: !input.requireFrame
        ? 'ok'
        : input.hasFramed
          ? 'ok'
          : (input.canFrame ? 'fail' : 'pending'),
      failHeadline: 'Frame required before Start',
      failAction: 'Click Frame to confirm where the laser will burn',
    },
    {
      id: 'currentModeAnchor',
      label: 'Laser head still at framed start',
      status:
        !input.requireFrame || input.startMode !== 'current'
          ? 'ok'
          : input.hasFramed && input.currentModeFrameAnchorValid
            ? 'ok'
            : 'fail',
      failHeadline: 'Laser head moved after framing',
      failAction: 'Frame again before starting from the laser head',
    },
    {
      id: 'laserState',
      label: 'Laser-safety state known',
      status: input.laserOutputState === 'unknown' ? 'fail' : 'ok',
      failHeadline: 'Laser-safety state unknown',
      failAction: 'A previous laser-off write failed — disconnect and reconnect to clear',
    },
    {
      id: 'wcsState',
      label: 'Work-coordinate state confirmed',
      status: input.placementUncertain ? 'fail' : 'ok',
      failHeadline: 'Work-coordinate state could not be confirmed',
      failAction: 'No WCS consent prompt was shown on connect — disconnect and reconnect to retry',
    },
    {
      id: 'connectionTrust',
      label: `Connection trust (${input.wifiTrust.label})`,
      status: input.wifiStartAllowed ? 'ok' : 'fail',
      failHeadline: 'Connection is not authenticated for safety-critical actions',
      failAction:
        input.wifiTrust.hint ?? 'Connect via USB, or grant a WiFi override before retrying.',
    },
  ];

  if (input.isRunning) {
    return { ready: true, blockingGate: null, gates };
  }

  const blockingGate = gates.find((g) => g.status === 'fail') ?? null;
  return {
    ready: input.canStartJob,
    blockingGate,
    gates,
  };
}
