/**
 * T2-43: typed `ControllerSafetyCapabilities`. Pre-T2-43 the safety
 * paths assumed GRBL behaviour everywhere — pause is recoverable,
 * stop invalidates position, soft-reset is the emergency stop, etc.
 * Audit 3D Required P0 ("safety capability gating") calls for these
 * to be declared so the UI/service can refuse unsupported operations
 * cleanly when a non-GRBL controller is wired in.
 *
 * T2-43 ships the type + the GRBL declaration. Threading this into
 * `ControllerInterface.capabilities.safety` is filed as
 * T2-43-followup so the per-controller migration touches every
 * implementer in one focused pass.
 */

/**
 * How a controller actually stops the laser when the user requests
 * an emergency stop. `unsupported` means the controller has no
 * mechanism — the safety service must refuse e-stop and surface the
 * reason ("controller does not support emergency stop").
 */
export type EmergencyStopMethod =
  | 'soft-reset'
  | 'kill-firmware'
  | 'native-stop'
  | 'unsupported';

export type LaserOffMethod = 'gcode-m5' | 'native' | 'pwm-zero' | 'unsupported';

export type PauseLatencyClass = 'realtime' | 'queued' | 'unknown';

/**
 * How the controller receives the job. This is related to, but not
 * identical to, physical stop-on-disconnect: host-streamed controllers
 * stop receiving new input when the link drops, but firmware may still
 * execute already-buffered motion.
 */
export type ExecutionModel = 'lineStream' | 'uploadedFile' | 'realtimeApi' | 'unknown';

/**
 * `boolean | 'unknown'` — the audit calls for explicit "we don't
 * know" rather than a default that might be wrong. Safety code reading
 * `'unknown'` must take the conservative path (assume the worst).
 */
export type SafetyTristate = boolean | 'unknown';

export interface ControllerSafetyCapabilities {
  // ─── Emergency stop ────────────────────────────────────────────
  supportsEmergencyStop: boolean;
  emergencyStopMethod: EmergencyStopMethod;
  /** Typical latency from issue to motion-stopped, or 'unknown'. */
  emergencyStopLatencyMs: number | 'unknown';

  // ─── Pause / resume ────────────────────────────────────────────
  supportsRecoverablePause: boolean;
  /** Whether issuing pause also commands laser off. */
  pauseStopsLaserOutput: SafetyTristate;
  pauseLatencyClass: PauseLatencyClass;
  /** True when the host must re-send modal state on resume. */
  resumeRequiresStateRestore: boolean;
  /** True when resume works after a controller-reported error. */
  resumeSupportedAfterError: boolean;

  // ─── Laser off ─────────────────────────────────────────────────
  supportsLaserOff: boolean;
  /** True when the controller acknowledges laser-off so the host can verify. */
  laserOffCanBeVerified: boolean;
  laserOffMethod: LaserOffMethod;

  // ─── Test fire ─────────────────────────────────────────────────
  supportsTestFire: boolean;
  /** True when the controller will only fire while moving (e.g. M3 vs M4). */
  testFireRequiresMotion: boolean;
  /** Hard upper bound the safety service enforces. */
  testFireMaxDurationMs: number;

  // ─── Side-effects of stop / disconnect ────────────────────────
  /**
   * True only when losing the host transport physically halts an active
   * job. "Host stops sending new lines" is not enough.
   */
  disconnectStopsJob: SafetyTristate;
  /** True when stop leaves the position counter untrusted (soft-reset, alarm). */
  stopInvalidatesPosition: SafetyTristate;
  /** True when stop requires a re-home before the next job. */
  stopRequiresRehome: SafetyTristate;

  // ─── Execution model ──────────────────────────────────────────
  executionModel: ExecutionModel;
}

/**
 * Capabilities for the GRBL 1.1 controller this app currently ships.
 * Sourced from the GRBL spec + observed Falcon A1 Pro behaviour:
 *
 * - `pauseStopsLaserOutput: 'unknown'` — depends on `$32` (laser
 *   mode); without reading it from `$$` we cannot promise either.
 * - `resumeRequiresStateRestore: true` — LaserForge's pause path
 *   sends `M5 S0`, so resume must reassert the captured `M3/M4 S0`
 *   modal spindle state before GRBL cycle-start (`~`).
 * - `resumeSupportedAfterError: false` — once GRBL enters Alarm,
 *   resume is not the right path; the user clears alarm + rehomes.
 * - `laserOffCanBeVerified: false` — we send M5 but cannot read back
 *   the laser-off state; the safety service must rely on the per-
 *   character ack as a best effort.
 * - `disconnectStopsJob: false` — GRBL is host-streamed, so closing
 *   the serial port stops new host input, but firmware may continue
 *   executing already-buffered RX/planner commands.
 * - `stopInvalidatesPosition: true` and `stopRequiresRehome: true` —
 *   our stop is a soft-reset; GRBL position counter is reset.
 */
export const grblSafetyCapabilities: ControllerSafetyCapabilities = {
  supportsEmergencyStop: true,
  emergencyStopMethod: 'soft-reset',
  emergencyStopLatencyMs: 50,

  supportsRecoverablePause: true,
  pauseStopsLaserOutput: 'unknown',
  pauseLatencyClass: 'realtime',
  resumeRequiresStateRestore: true,
  resumeSupportedAfterError: false,

  supportsLaserOff: true,
  laserOffCanBeVerified: false,
  laserOffMethod: 'gcode-m5',

  supportsTestFire: true,
  testFireRequiresMotion: false,
  testFireMaxDurationMs: 5000,

  disconnectStopsJob: false,
  stopInvalidatesPosition: true,
  stopRequiresRehome: true,

  executionModel: 'lineStream',
};

/**
 * Predicates the safety service uses when refusing an unsupported
 * operation. Each one returns a reason string when the operation is
 * NOT permitted, or null when it is. The text is suitable for direct
 * surfacing in a SafetyActionResult.message.
 */
export function reasonEmergencyStopRefused(
  caps: ControllerSafetyCapabilities,
): string | null {
  if (!caps.supportsEmergencyStop) return 'Controller does not support emergency stop.';
  if (caps.emergencyStopMethod === 'unsupported') return 'Controller does not support emergency stop.';
  return null;
}

export function reasonPauseRefused(
  caps: ControllerSafetyCapabilities,
): string | null {
  if (!caps.supportsRecoverablePause) return 'Controller does not support pause.';
  return null;
}

export function reasonResumeAfterErrorRefused(
  caps: ControllerSafetyCapabilities,
): string | null {
  if (!caps.resumeSupportedAfterError) {
    return 'Controller does not support resume after error — clear the alarm and re-home.';
  }
  return null;
}

export function reasonTestFireRefused(
  caps: ControllerSafetyCapabilities,
  requestedDurationMs: number,
): string | null {
  if (!caps.supportsTestFire) return 'Controller does not support test fire.';
  if (requestedDurationMs > caps.testFireMaxDurationMs) {
    return `Test fire duration ${requestedDurationMs}ms exceeds controller maximum ${caps.testFireMaxDurationMs}ms.`;
  }
  return null;
}
