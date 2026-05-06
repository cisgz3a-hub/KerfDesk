/**
 * T2-25: first-class `ControllerCapabilities` model. Pre-T2-25
 * capabilities were scattered across `DeviceProfile.ts` as booleans
 * (`autoFocusSupported`, `homingEnabled`, `softLimitsEnabled`,
 * `allowsNegativeWorkspace`, `stopOnError`, `suppressWcsConsent`)
 * and the rest were implicit ("ExecutionCoordinator.unlock()
 * assumes `$X` support; for Marlin or Ruida the entire jog/home/
 * unlock UI is wrong"). Audit 3A section 5 + Priority 2.
 *
 * T2-25 ships the full type plus the GRBL declaration plus the
 * `assertCapability` gate. Wiring `ControllerInterface.capabilities`
 * + UI consumption is filed as T2-25-followup so each consumer
 * (ExecutionCoordinator, MachineService.jog, ControlPanel) gets
 * reviewed independently.
 *
 * Pairs with T2-43 (`ControllerSafetyCapabilities` shipped in
 * `dc60b2e`). T2-43 covers the SAFETY axis; T2-25 covers the
 * full capability surface (output/laser/motion/operations/transport).
 */

export type OutputFormat = 'gcode-text' | 'gcode-binary' | 'native-binary';
export type JobExecutionModel = 'line-stream' | 'file-upload' | 'binary-stream' | 'device-native';
export type PowerUnit = 'percent' | 'spindle-s' | 'pwm-byte' | 'native';
export type LaserOffOperation = 'gcode-m5' | 'native-stop' | 'pwm-zero' | 'unsupported';
export type MotionAxis = 'x' | 'y' | 'z' | 'rotary';
export type CoordinateSystem = 'cartesian' | 'galvo' | 'other';
export type StartMode = 'absolute' | 'current' | 'savedOrigin';
export type TransportKind = 'usb-serial' | 'wifi' | 'usb-bulk' | 'native';
export type AckModel = 'ok-line' | 'byte-ack' | 'device-progress' | 'none';

export interface ControllerCapabilities {
  output: {
    formats: OutputFormat[];
    jobExecution: JobExecutionModel;
    supportsGcode: boolean;
    supportsBinary: boolean;
    maxLineLength?: number;
    maxJobBytes?: number;
  };
  laser: {
    powerUnit: PowerUnit;
    maxPowerValue: number;
    supportsDynamicPower: boolean;
    supportsConstantPower: boolean;
    supportsInlinePower: boolean;
    laserOffOperation: LaserOffOperation;
  };
  motion: {
    axes: MotionAxis[];
    coordinateSystem: CoordinateSystem;
    supportsAbsolute: boolean;
    supportsRelative: boolean;
    originModes: StartMode[];
    bedWidthMm: number;
    bedHeightMm: number;
  };
  operations: {
    canHome: boolean;
    canUnlock: boolean;
    canJog: boolean;
    canSetWorkOrigin: boolean;
    canFrame: boolean;
    canTestFire: boolean;
    canAutofocus: boolean;
    canPause: boolean;
    canResume: boolean;
    canSoftStop: boolean;
    canEmergencyStop: boolean;
  };
  transport: {
    supportedKinds: TransportKind[];
    ackModel: AckModel;
  };
}

/**
 * GRBL 1.1 capabilities — the contract this app currently ships.
 * Each value is documented above; the operations block here MAY
 * legitimately differ from `grblSafetyCapabilities` (T2-43) which
 * tracks the safety-specific facets (e-stop method, latency, etc.).
 */
export const grblCapabilities: ControllerCapabilities = {
  output: {
    formats: ['gcode-text'],
    jobExecution: 'line-stream',
    supportsGcode: true,
    supportsBinary: false,
    maxLineLength: 80,         // GRBL limit; longer lines rejected
    maxJobBytes: undefined,    // host-streamed; no upper bound
  },
  laser: {
    powerUnit: 'spindle-s',
    maxPowerValue: 1000,       // overridable per profile via $30
    supportsDynamicPower: true,   // M4
    supportsConstantPower: true,  // M3
    supportsInlinePower: false,   // GRBL has no per-segment S
    laserOffOperation: 'gcode-m5',
  },
  motion: {
    axes: ['x', 'y'],
    coordinateSystem: 'cartesian',
    supportsAbsolute: true,
    supportsRelative: true,
    originModes: ['absolute', 'current', 'savedOrigin'],
    bedWidthMm: 400,
    bedHeightMm: 300,
  },
  operations: {
    canHome: true,
    canUnlock: true,
    canJog: true,
    canSetWorkOrigin: true,
    canFrame: true,
    canTestFire: true,
    canAutofocus: false,       // hardware-specific; profiles override
    canPause: true,
    canResume: true,
    canSoftStop: true,
    canEmergencyStop: true,
  },
  transport: {
    supportedKinds: ['usb-serial'],
    ackModel: 'ok-line',
  },
};

/**
 * The contract a future controller (Marlin, Ruida, native binary
 * formats) advertises. The interface is exhaustive on purpose: the
 * tests source-scan the codebase to verify every operation site
 * checks `capabilities.operations.canX` before issuing the command.
 */
export interface CapabilityCheckResult {
  ok: boolean;
  /** When ok=false, a user-facing reason. Suitable for SafetyActionResult.message. */
  reason?: string;
}

/** Operation flags exposed on `capabilities.operations`. */
export type OperationCapability =
  keyof ControllerCapabilities['operations'];

/**
 * Gate every operation entrypoint goes through. Returns ok:true when
 * the operation is supported; ok:false with a reason ready for
 * surfacing in the UI (toast / SafetyActionResult.message) when not.
 */
export function checkOperationCapability(
  caps: ControllerCapabilities,
  op: OperationCapability,
): CapabilityCheckResult {
  if (caps.operations[op]) return { ok: true };
  return {
    ok: false,
    reason: `Controller does not support ${humanReadableOperation(op)}.`,
  };
}

function humanReadableOperation(op: OperationCapability): string {
  switch (op) {
    case 'canHome': return 'home';
    case 'canUnlock': return 'unlock';
    case 'canJog': return 'jog';
    case 'canSetWorkOrigin': return 'set work origin';
    case 'canFrame': return 'frame';
    case 'canTestFire': return 'test fire';
    case 'canAutofocus': return 'autofocus';
    case 'canPause': return 'pause';
    case 'canResume': return 'resume';
    case 'canSoftStop': return 'soft stop';
    case 'canEmergencyStop': return 'emergency stop';
  }
}

/**
 * Compose `caps` with profile-derived overrides. Profiles are the
 * runtime authority for `homingEnabled` / `autoFocusSupported`
 * (DeviceProfile fields) — those override the controller-default
 * declaration. Returns a new capabilities object; input not mutated.
 */
export interface ProfileOverrides {
  homingEnabled?: boolean;
  autofocusSupported?: boolean;
  bedWidthMm?: number;
  bedHeightMm?: number;
  maxPowerValue?: number;
}

export function applyProfileOverrides(
  caps: ControllerCapabilities,
  overrides: ProfileOverrides,
): ControllerCapabilities {
  const next: ControllerCapabilities = JSON.parse(JSON.stringify(caps));
  if (overrides.homingEnabled !== undefined) next.operations.canHome = overrides.homingEnabled;
  if (overrides.autofocusSupported !== undefined) next.operations.canAutofocus = overrides.autofocusSupported;
  if (overrides.bedWidthMm !== undefined && Number.isFinite(overrides.bedWidthMm) && overrides.bedWidthMm > 0) {
    next.motion.bedWidthMm = overrides.bedWidthMm;
  }
  if (overrides.bedHeightMm !== undefined && Number.isFinite(overrides.bedHeightMm) && overrides.bedHeightMm > 0) {
    next.motion.bedHeightMm = overrides.bedHeightMm;
  }
  if (overrides.maxPowerValue !== undefined && Number.isFinite(overrides.maxPowerValue) && overrides.maxPowerValue > 0) {
    next.laser.maxPowerValue = overrides.maxPowerValue;
  }
  return next;
}
