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
import type { WcsUncertainReason } from '../../../controllers/grbl/GrblWcsConsentClassifier';
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
  readonly hasCompiledGcode?: boolean;
  readonly gcodeStale: boolean;
  readonly isSimulator: boolean;
  readonly machineBlocksJobStart: boolean;
  readonly canFrame: boolean;
  readonly requireFrame: boolean;
  readonly hasFramed: boolean;
  readonly startMode: GcodeStartMode;
  readonly currentModeFrameAnchorValid: boolean;
  readonly placementUncertain: boolean;
  /**
   * T1-203: when the controller declared placement uncertain, why. The
   * controller knows (`getPlacementUncertainReason()`) but pre-T1-203
   * the gate showed a single misleading message ("No WCS consent
   * prompt was shown") for all four causes. `null` means either the
   * gate is passing OR the T1-20 no-listener path fired (which is the
   * only case the original message describes correctly).
   */
  readonly placementUncertainReason: WcsUncertainReason | null;
  readonly allowUnverifiedWcsStart: boolean;
  /**
   * Same machine/safety gate used by the footer Reset WCS button. The
   * inline readiness action must not receive a raw callback that can
   * bypass the footer's idle / laser-off / operation gate.
   */
  readonly canResetWcsToBaseline?: boolean;
  /**
   * T1-205: callback for the "Reset WCS to baseline" recovery
   * button. When set AND the WCS gate is failing with a
   * data-failure reason (missing/malformed G54 or $10), the gate
   * surfaces an inline button that invokes this callback. Calling
   * `GrblController.applyWcsNormalization()` is the natural
   * implementation — it sends `G10 L2 P1 X0 Y0 Z0` + `$10=0` and
   * clears the placement-uncertain flag locally. `null` (no
   * callback) leaves the gate text-only as before T1-205.
   */
  readonly onResetWcsToBaseline: (() => void) | null;
  readonly wifiTrust: TrustClassification;
  readonly wifiStartAllowed: boolean;
  readonly isRunning: boolean;
  readonly canStartJob: boolean;
}

/**
 * T1-203: produce the WCS-state gate row with a reason-tailored
 * failHeadline + failAction. Pre-T1-203 the gate showed a single
 * misleading message ("No WCS consent prompt was shown") for all
 * four trigger paths — which only describes the T1-20 no-listener
 * race. Users hitting T1-117 (malformed G54 / $10) or T1-174 ($#
 * returned error:) saw advice that didn't match their actual
 * problem. T1-203 surfaces the reason from
 * `GrblController.getPlacementUncertainReason()` (already stored,
 * just unwired in the UI) so each cause gets its own recovery path.
 */
function wcsStateGate(input: BuildStartReadinessInput): StartReadinessGate {
  if (!input.placementUncertain) {
    return {
      id: 'wcsState',
      label: 'Work-coordinate state confirmed',
      status: 'ok',
      failHeadline: 'Work-coordinate state could not be confirmed',
      failAction: 'No WCS consent prompt was shown on connect — disconnect and reconnect to retry',
    };
  }
  if (input.allowUnverifiedWcsStart) {
    return {
      id: 'wcsState',
      label: 'Work-coordinate state accepted by profile',
      status: 'ok',
      failHeadline: 'Work-coordinate verification bypassed by machine profile',
      failAction: 'This profile uses manual-zero compatibility because the controller cannot reliably report G54/$10 WCS state.',
    };
  }
  let failHeadline: string;
  let failAction: string;
  // T1-205: data-failure reasons (missing/malformed G54 or $10) get
  // a "Reset WCS to baseline" recovery button alongside the
  // descriptive text. The button calls `applyWcsNormalization()` on
  // the controller, which sends `G10 L2 P1 X0 Y0 Z0` (sets G54 to
  // baseline, persistent in EEPROM) + `$10=0` and clears the
  // placement-uncertain flag locally — no reconnect cycle needed.
  // wcs_query_error and the null (T1-20 listener race) cases don't
  // get a button: the former needs the user to clear an alarm at
  // the controller level (soft-reset / M999) and the latter is a
  // reconnect race.
  let offerResetButton = false;
  switch (input.placementUncertainReason) {
    case 'wcs_query_error':
      failHeadline = 'Controller refused the WCS query ($#)';
      failAction = 'The controller returned an error to $#. Clear any alarm (soft-reset / M999) and reconnect.';
      break;
    case 'missing_g54':
      failHeadline = 'Controller did not report a G54 offset';
      failAction = 'The $# response contained no [G54:...] line. Use the button below to initialize G54 = (0,0,0) on the controller (persists in EEPROM).';
      offerResetButton = true;
      break;
    case 'malformed_g54':
      failHeadline = 'Controller reported a malformed G54 offset';
      failAction = 'The [G54:...] response had unparseable coordinates. Use the button below to reset G54 to baseline, or check the USB cable for noise.';
      offerResetButton = true;
      break;
    case 'missing_status_mask':
      failHeadline = 'Controller did not report a $10 status mask';
      failAction = 'The $$ settings dump did not include $10. Use the button below to set $10=0 on the controller.';
      offerResetButton = true;
      break;
    case 'malformed_status_mask':
      failHeadline = 'Controller reported a malformed $10 value';
      failAction = 'The $10= value was unparseable. Use the button below to reset $10=0, or check the USB cable for noise.';
      offerResetButton = true;
      break;
    case null:
      // T1-20 no-listener fallback: no reason stored. The original
      // pre-T1-203 message is correct for exactly this case.
      failHeadline = 'Work-coordinate state could not be confirmed';
      failAction = 'No WCS consent prompt was shown on connect — disconnect and reconnect to retry.';
      break;
  }
  return {
    id: 'wcsState',
    label: 'Work-coordinate state confirmed',
    status: 'fail',
    failHeadline,
    failAction,
    failActionButton: offerResetButton && input.canResetWcsToBaseline && input.onResetWcsToBaseline
      ? {
          label: 'Reset WCS to baseline (G10 L2 P1 X0 Y0 Z0)',
          onClick: input.onResetWcsToBaseline,
        }
      : undefined,
  };
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
  const hasCompiledGcode = input.hasCompiledGcode ?? Boolean(input.gcode);
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
      status: hasCompiledGcode ? 'ok' : 'fail',
      failHeadline: 'No G-code yet',
      failAction: 'Click G-code in the toolbar to compile this design',
    },
    {
      id: 'gcodeFresh',
      label: 'G-code matches current design',
      status: !hasCompiledGcode ? 'pending' : (input.gcodeStale ? 'fail' : 'ok'),
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
      label: 'Laser is off',
      status: input.laserOutputState === 'off' ? 'ok' : 'fail',
      failHeadline:
        input.laserOutputState === 'unknown'
          ? 'Laser-safety state unknown'
          : input.laserOutputState === 'on'
            ? 'Laser is still on'
            : 'Laser-safety state not confirmed',
      failAction:
        input.laserOutputState === 'unknown'
          ? 'A previous laser-off write failed - disconnect and reconnect to clear'
          : 'Wait for the laser-off acknowledgement, or click Stop / E-Stop',
    },
    {
      id: 'noActiveOperation',
      label: 'No active machine operation',
      status: input.activeOperation == null ? 'ok' : 'fail',
      failHeadline: input.activeOperation
        ? `Operation "${input.activeOperation.kind}" is still in progress`
        : 'A machine operation is still in progress',
      failAction: 'Wait for the operation to finish, or click Stop to cancel it',
    },
    {
      id: 'noControllerError',
      label: 'No controller error',
      status: input.machineState?.errorCode == null ? 'ok' : 'fail',
      failHeadline: input.machineState?.errorCode != null
        ? `Controller error ${input.machineState.errorCode}`
        : 'Controller reported an error',
      failAction: 'Read the controller log and clear the error before starting',
    },
    wcsStateGate(input),
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
