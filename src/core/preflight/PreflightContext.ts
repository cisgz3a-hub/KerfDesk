/**
 * @copyright (c) 2025 LaserForge. All rights reserved.
 *
 * T1-227: shared preflight rule contracts live here so rule modules do not
 * import the Preflight orchestrator that imports them.
 */
import type { DeviceIdentity, MachineStatus } from '../../controllers/ControllerInterface';
import type { DeviceProfile } from '../devices/DeviceProfile';
import type { GcodeStartMode } from '../output/GcodeOrigin';
import type { Scene } from '../scene/Scene';
export type PreflightSeverity = 'error' | 'warning' | 'info';

export interface PreflightResult {
  severity: PreflightSeverity;
  code: string;
  message: string;
  layerId?: string;
  objectId?: string;
  fix?: PreflightFix;
}

export interface PreflightOutputSemanticFinding {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  lineNumber: number;
  line: string;
}

export interface PreflightFix {
  label: string;
  action:
    | { type: 'fitToBed' }
    | { type: 'clampToOrigin' }
    | { type: 'setLayerPower'; layerId: string; power: number }
    | { type: 'setLayerSpeed'; layerId: string; speed: number }
    | { type: 'enableHoming' }
    | { type: 'disableSmartOverscan'; layerId: string };
}

export const PREFLIGHT_CODES = {
  SCENE_EMPTY: 'SCENE_EMPTY',
  OUT_OF_BOUNDS_MAX: 'OUT_OF_BOUNDS_MAX',
  OUT_OF_BOUNDS_MIN: 'OUT_OF_BOUNDS_MIN',
  LAYER_POWER_ZERO: 'LAYER_POWER_ZERO',
  LAYER_SPEED_ZERO: 'LAYER_SPEED_ZERO',
  LAYER_SPEED_NEGATIVE: 'LAYER_SPEED_NEGATIVE',
  NO_VISIBLE_LAYERS: 'NO_VISIBLE_LAYERS',
  MISSING_MAX_SPINDLE: 'MISSING_MAX_SPINDLE',
  MISSING_BED_SIZE: 'MISSING_BED_SIZE',
  LAYER_POWER_HIGH: 'LAYER_POWER_HIGH',
  LAYER_POWER_RANGE_INVALID: 'LAYER_POWER_RANGE_INVALID',
  LAYER_SPEED_INVALID: 'LAYER_SPEED_INVALID',
  LAYER_SPEED_HIGH: 'LAYER_SPEED_HIGH',
  LAYER_SPEED_LOW: 'LAYER_SPEED_LOW',
  /** S25-07-002: layer Z-step output is blocked unless profile Z support is explicit. */
  Z_AXIS_UNSUPPORTED: 'Z_AXIS_UNSUPPORTED',
  /** S25-07-002: profile enables Z travel but lacks safe min/max limits. */
  Z_AXIS_LIMITS_MISSING: 'Z_AXIS_LIMITS_MISSING',
  /** S25-07-002: planned pass-to-pass Z travel exceeds configured safe range. */
  Z_AXIS_OUT_OF_RANGE: 'Z_AXIS_OUT_OF_RANGE',
  OVERSCAN_EXCEEDS_BED: 'OVERSCAN_EXCEEDS_BED',
  HOMING_ENABLED_NO_H: 'HOMING_ENABLED_NO_H',
  ACCEL_AWARE_NO_ACCEL_PARAM: 'ACCEL_AWARE_NO_ACCEL_PARAM',
  /** T1-32: M4 dynamic-mode job emitted against a controller reporting $32=0 (CNC/spindle mode). */
  MACHINE_LASER_MODE_DISABLED: 'MACHINE_LASER_MODE_DISABLED',
  /** T3-56: connected controller has not reported $32; M4 dynamic-power output is unsafe until verified. */
  MACHINE_LASER_MODE_UNKNOWN: 'MACHINE_LASER_MODE_UNKNOWN',
  /** T1-33: profile.maxSpindle disagrees with controller $30 by more than 5% — over-power risk. */
  MACHINE_MAXSPINDLE_MISMATCH: 'MACHINE_MAXSPINDLE_MISMATCH',
  /** T1-55: connected to a controller that has not yet reported $30 — laser-on operations refuse. */
  MACHINE_MAXSPINDLE_UNKNOWN: 'MACHINE_MAXSPINDLE_UNKNOWN',
  /** T1-25: connect-time safe-state handshake reported a non-safe controller state. */
  MACHINE_UNSAFE_AT_CONNECT: 'MACHINE_UNSAFE_AT_CONNECT',
  /** T2-16: two or more objects with identical transform + geometry signature — likely stacked duplicates. */
  GEOMETRY_DUPLICATE: 'GEOMETRY_DUPLICATE',
  /** T3-31: closed vector geometry crosses itself and can break fill/cut planning. */
  GEOMETRY_SELF_INTERSECTION: 'GEOMETRY_SELF_INTERSECTION',
  /** T3-39: corrupted/manual scene geometry has NaN or Infinity coordinates. */
  GEOMETRY_NONFINITE: 'GEOMETRY_NONFINITE',
  /** T1-45: compile complexity gate — info / warning / blocker depending on estimated G-code line count + memory footprint. */
  COMPILE_COMPLEXITY_INFO: 'COMPILE_COMPLEXITY_INFO',
  COMPILE_COMPLEXITY_WARN: 'COMPILE_COMPLEXITY_WARN',
  COMPILE_COMPLEXITY_BLOCK: 'COMPILE_COMPLEXITY_BLOCK',
  /** F45-12-001: dense fill line interval was coarsened to stay within the scanline cap. */
  FILL_INTERVAL_COARSENED: 'FILL_INTERVAL_COARSENED',
  LONG_JOB: 'LONG_JOB',
  BED_SIZE_MISMATCH: 'BED_SIZE_MISMATCH',
  HIDDEN_LAYER_HAS_OBJECTS: 'HIDDEN_LAYER_HAS_OBJECTS',
  EMPTY_LAYER: 'EMPTY_LAYER',
  CALIBRATION_NOT_MONOTONIC: 'CALIBRATION_NOT_MONOTONIC',
  OPTIMIZE_ORDER_OFF: 'OPTIMIZE_ORDER_OFF',
  SMART_OVERSCAN_OFF_FAST: 'SMART_OVERSCAN_OFF_FAST',
  ACCEL_AWARE_OFF_RASTER: 'ACCEL_AWARE_OFF_RASTER',
  MACHINE_ALARM: 'MACHINE_ALARM',
  MACHINE_FAULTED: 'MACHINE_FAULTED',
  MACHINE_HOLD: 'MACHINE_HOLD',
  MACHINE_DOOR: 'MACHINE_DOOR',
  MACHINE_RUNNING: 'MACHINE_RUNNING',
  MACHINE_HOMING: 'MACHINE_HOMING',
  MACHINE_NOT_IDLE: 'MACHINE_NOT_IDLE',
  MACHINE_DISCONNECTED: 'MACHINE_DISCONNECTED',
  NO_GCODE: 'NO_GCODE',
  OUTPUT_NEGATIVE_X: 'OUTPUT_NEGATIVE_X',
  OUTPUT_NEGATIVE_Y: 'OUTPUT_NEGATIVE_Y',
  OUTPUT_EXCEEDS_BED_X: 'OUTPUT_EXCEEDS_BED_X',
  OUTPUT_EXCEEDS_BED_Y: 'OUTPUT_EXCEEDS_BED_Y',
  OUTPUT_LASER_ON_BEFORE_SETUP: 'OUTPUT_LASER_ON_BEFORE_SETUP',
  OUTPUT_RAPID_WITH_LASER_ON: 'OUTPUT_RAPID_WITH_LASER_ON',
  OUTPUT_LASER_LEFT_ON: 'OUTPUT_LASER_LEFT_ON',
  OUTPUT_SPINDLE_EXCEEDS_MAX: 'OUTPUT_SPINDLE_EXCEEDS_MAX',
  OUTPUT_FEED_INVALID: 'OUTPUT_FEED_INVALID',
  OUTPUT_UNSUPPORTED_COMMAND: 'OUTPUT_UNSUPPORTED_COMMAND',
  OUTPUT_LINE_TOO_LONG: 'OUTPUT_LINE_TOO_LONG',
  GCODE_TRAVEL_NEGATIVE_X: 'GCODE_TRAVEL_NEGATIVE_X',
  GCODE_TRAVEL_NEGATIVE_Y: 'GCODE_TRAVEL_NEGATIVE_Y',
  GCODE_TRAVEL_EXCEED_X: 'GCODE_TRAVEL_EXCEED_X',
  GCODE_TRAVEL_EXCEED_Y: 'GCODE_TRAVEL_EXCEED_Y',
  DESIGN_NO_OUTPUT: 'DESIGN_NO_OUTPUT',
  DESIGN_OUTSIDE_MATERIAL_FULL: 'DESIGN_OUTSIDE_MATERIAL_FULL',
  DESIGN_OUTSIDE_MATERIAL_PARTIAL: 'DESIGN_OUTSIDE_MATERIAL_PARTIAL',
  DESIGN_OUTSIDE_BED: 'DESIGN_OUTSIDE_BED',
  TEXT_FONT_TOO_SMALL: 'TEXT_FONT_TOO_SMALL',
  TEXT_EMPTY: 'TEXT_EMPTY',
  ENGRAVE_FILL_TOO_SMALL: 'ENGRAVE_FILL_TOO_SMALL',
  IMAGE_MISSING_RASTER: 'IMAGE_MISSING_RASTER',
  IMAGE_ROTATED_SKEWED: 'IMAGE_ROTATED_SKEWED',
  IMAGE_POWER_MIN_MARKS_WHITE: 'IMAGE_POWER_MIN_MARKS_WHITE',
  SETTINGS_CUT_OVERBURN: 'SETTINGS_CUT_OVERBURN',
  LAYER_OUTPUT_SUMMARIES: 'LAYER_OUTPUT_SUMMARIES',
  /** Header template has `$H` but live GRBL reports $22=0 (homing cycle disabled). */
  HOMING_REQUESTED_BUT_DISABLED: 'HOMING_REQUESTED_BUT_DISABLED',
} as const;

export interface PreflightContext {
  scene: Scene;
  profile: DeviceProfile | null;
  optimizeOrderEnabled: boolean;
  estimatedTimeSeconds?: number;
  liveMachineInfo?: {
    bedWidthMm?: number;
    bedHeightMm?: number;
    maxSpindle?: number;
    maxRateX?: number;
    maxRateY?: number;
    maxAccelX?: number;
    maxAccelY?: number;
    /** T3-57/S25-01: full live firmware/settings identity for profile-vs-firmware mismatch checks. */
    deviceIdentity?: DeviceIdentity | null;
    homingEnabled?: boolean;
    /** GRBL $32: laser mode. true = dynamic ($32=1), false = CNC ($32=0), undefined = not read. */
    laserMode?: boolean;
    /**
     * T1-25: connect-time safe-state verdict. `null` = handshake passed
     * (idle + FS 0,0); a non-null string is the failure reason that the
     * preflight rule renders as a blocker until the user reconnects.
     */
    unsafeAtConnect?:
      | 'alarm'
      | 'run'
      | 'hold'
      | 'door'
      | 'check'
      | 'no-status-response'
      | 'unsafe-residual-spindle'
      | null;
  };
  gcodeHeaderPreview?: string;
  /** When set, GRBL-style machine status for job-start guardrails. */
  machineStatus?: MachineStatus | null;
  startMode?: GcodeStartMode;
  /**
   * Physical machine coordinate for local work zero. For head mode this is the
   * current machine position; for saved-zero mode this is the saved origin.
   */
  workOriginMachinePosition?: { x: number; y: number } | null;
  machineAlarmCode?: number | null;
  hasGcode?: boolean;
  /** Machine-space plan bounds from applyMachineTransform (preferred over scene bounds for output checks). */
  machinePlanBounds?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /**
   * When false, machine is not connected (UI checker). When undefined, machine connection is not asserted (standalone tests).
   */
  connectedToMachine?: boolean;
  /** When `machinePlanBounds` is absent, optional G-code text for travel XY bounds scan only. */
  gcodeTravelScan?: string | null;
  /** Final emitted G-code text for T3-18 semantic safety validation. */
  emittedGcode?: string | null;
  /** Precomputed semantic findings from a spool-backed output stream. */
  emittedGcodeFindings?: readonly PreflightOutputSemanticFinding[];
  /**
   * T1-32: precomputed flag for "the compiled output emits M4 dynamic-power somewhere."
   * Set at the runPreflightSummary boundary by scanning the gcode once. Drives the
   * MACHINE_LASER_MODE_DISABLED check without the rule having to re-scan.
   */
  outputUsesM4?: boolean;
  /**
   * Design vs machine bed (mm) for "outside bed" design checks. Same source as
   * `resolveBedWidthMm` / `resolveBedHeightMm` at the `runPreflightSummary` call site.
   */
  preflightBedWidthMm: number;
  preflightBedHeightMm: number;
}
