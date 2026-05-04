/**
 * @copyright (c) 2025 LaserForge. All rights reserved.
 */
import { createBlankProfile, getActiveProfile, type DeviceProfile } from '../devices/DeviceProfile';
import type { Scene } from '../scene/Scene';
import type { ValidatedJobTicket } from '../job/ValidatedJobTicket';
import type { MachineState, MachineStatus } from '../../controllers/ControllerInterface';
import { runMachineStateChecks } from './rules/MachineStatePreflight';
import { runSceneChecks, runDesignOutputLayerChecks } from './rules/ScenePreflight';
import {
  runOutputBoundsChecks,
  runGcodeTravelBoundsChecks,
  runBoundsChecks,
} from './rules/OutputBoundsPreflight';
import { runLayerChecks } from './rules/LayerSettingsPreflight';
import { runMachineChecks } from './rules/MachinePreflight';
import {
  runTemplateChecks,
  runGcodeTemplateSemanticValidation,
} from './rules/TemplatePreflight';
import { runRasterChecks } from './rules/RasterPreflight';
import { runOptimizationChecks } from './rules/OptimizationPreflight';

export type PreflightSeverity = 'error' | 'warning' | 'info';

export interface PreflightResult {
  severity: PreflightSeverity;
  code: string;
  message: string;
  layerId?: string;
  objectId?: string;
  fix?: PreflightFix;
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
  LAYER_SPEED_HIGH: 'LAYER_SPEED_HIGH',
  LAYER_SPEED_LOW: 'LAYER_SPEED_LOW',
  OVERSCAN_EXCEEDS_BED: 'OVERSCAN_EXCEEDS_BED',
  HOMING_ENABLED_NO_H: 'HOMING_ENABLED_NO_H',
  ACCEL_AWARE_NO_ACCEL_PARAM: 'ACCEL_AWARE_NO_ACCEL_PARAM',
  /** T1-32: M4 dynamic-mode job emitted against a controller reporting $32=0 (CNC/spindle mode). */
  MACHINE_LASER_MODE_DISABLED: 'MACHINE_LASER_MODE_DISABLED',
  /** T1-33: profile.maxSpindle disagrees with controller $30 by more than 5% — over-power risk. */
  MACHINE_MAXSPINDLE_MISMATCH: 'MACHINE_MAXSPINDLE_MISMATCH',
  /** T1-55: connected to a controller that has not yet reported $30 — laser-on operations refuse. */
  MACHINE_MAXSPINDLE_UNKNOWN: 'MACHINE_MAXSPINDLE_UNKNOWN',
  /** T1-25: connect-time safe-state handshake reported a non-safe controller state. */
  MACHINE_UNSAFE_AT_CONNECT: 'MACHINE_UNSAFE_AT_CONNECT',
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
  MACHINE_RUNNING: 'MACHINE_RUNNING',
  MACHINE_HOMING: 'MACHINE_HOMING',
  MACHINE_NOT_IDLE: 'MACHINE_NOT_IDLE',
  MACHINE_DISCONNECTED: 'MACHINE_DISCONNECTED',
  NO_GCODE: 'NO_GCODE',
  OUTPUT_NEGATIVE_X: 'OUTPUT_NEGATIVE_X',
  OUTPUT_NEGATIVE_Y: 'OUTPUT_NEGATIVE_Y',
  OUTPUT_EXCEEDS_BED_X: 'OUTPUT_EXCEEDS_BED_X',
  OUTPUT_EXCEEDS_BED_Y: 'OUTPUT_EXCEEDS_BED_Y',
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
      | 'check'
      | 'no-status-response'
      | 'unsafe-residual-spindle'
      | null;
  };
  gcodeHeaderPreview?: string;
  /** When set, GRBL-style machine status for job-start guardrails. */
  machineStatus?: MachineStatus | null;
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

export function runPreflight(ctx: PreflightContext): PreflightResult[] {
  const results: PreflightResult[] = [];
  runMachineStateChecks(ctx, results);
  runSceneChecks(ctx, results);
  runDesignOutputLayerChecks(ctx, results);
  runOutputBoundsChecks(ctx, results);
  runGcodeTravelBoundsChecks(ctx, results);
  runBoundsChecks(ctx, results);
  runLayerChecks(ctx, results);
  runMachineChecks(ctx, results);
  runTemplateChecks(ctx, results);
  runGcodeTemplateSemanticValidation(ctx, results);
  runRasterChecks(ctx, results);
  runOptimizationChecks(ctx, results);
  ensureNoCompiledOutputIssue(ctx, results);
  return sortBySeverity(results);
}

export function hasBlockingErrors(results: PreflightResult[]): boolean {
  return results.some(r => r.severity === 'error');
}

export function groupBySeverity(
  results: PreflightResult[],
): Record<PreflightSeverity, PreflightResult[]> {
  return {
    error: results.filter(r => r.severity === 'error'),
    warning: results.filter(r => r.severity === 'warning'),
    info: results.filter(r => r.severity === 'info'),
  };
}

// ─────────────────────────────────────────────────────────────
// UI-facing summary (legacy PreflightChecker shape, inlined here)
// ─────────────────────────────────────────────────────────────

export type IssueSeverity = 'blocker' | 'warning' | 'info';

export interface PreflightIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  fix?: string;
  category: 'machine' | 'design' | 'settings' | 'output';
}

export interface PreflightSummary {
  score: number;
  issues: PreflightIssue[];
  blockers: number;
  warnings: number;
  canStart: boolean;
  /** When set, the compile-time job ticket merged in by the UI (phase 1+). */
  validatedTicket?: ValidatedJobTicket;
}

function categorizeCode(code: string): 'machine' | 'design' | 'settings' | 'output' {
  if (code.startsWith('MACHINE_')) return 'machine';
  if (code === 'NO_GCODE' || code.startsWith('OUTPUT_') || code.startsWith('GCODE_TRAVEL_')) return 'output';
  if (
    code.includes('DESIGN_') ||
    code.includes('TEXT_') ||
    code.includes('IMAGE_') ||
    code.includes('ENGRAVE_') ||
    code.includes('EMPTY') ||
    code.includes('SCENE')
  ) {
    return 'design';
  }
  if (code.includes('LAYER') || code.includes('POWER') || code.includes('SPEED') || code.includes('SETTINGS_')) {
    return 'settings';
  }
  if (code === PREFLIGHT_CODES.HOMING_REQUESTED_BUT_DISABLED) {
    return 'settings';
  }
  if (code.startsWith('TEMPLATE_') || code === 'FOOTER_MISSING_M5') {
    return 'settings';
  }
  return 'output';
}

function legacyIssueId(r: PreflightResult, index: number): string {
  switch (r.code) {
    case PREFLIGHT_CODES.NO_GCODE:
      return 'output-no-gcode';
    case PREFLIGHT_CODES.MACHINE_DISCONNECTED:
      return 'machine-disconnected';
    case PREFLIGHT_CODES.OUTPUT_NEGATIVE_X:
    case PREFLIGHT_CODES.GCODE_TRAVEL_NEGATIVE_X:
      return 'output-negative-x';
    case PREFLIGHT_CODES.OUTPUT_NEGATIVE_Y:
    case PREFLIGHT_CODES.GCODE_TRAVEL_NEGATIVE_Y:
      return 'output-negative-y';
    case PREFLIGHT_CODES.OUTPUT_EXCEEDS_BED_X:
    case PREFLIGHT_CODES.GCODE_TRAVEL_EXCEED_X:
      return 'output-exceed-x';
    case PREFLIGHT_CODES.OUTPUT_EXCEEDS_BED_Y:
    case PREFLIGHT_CODES.GCODE_TRAVEL_EXCEED_Y:
      return 'output-exceed-y';
    case PREFLIGHT_CODES.DESIGN_NO_OUTPUT:
      return 'design-empty';
    case PREFLIGHT_CODES.DESIGN_OUTSIDE_MATERIAL_FULL:
      return r.objectId ? `design-outside-material-full-${r.objectId}` : `design-outside-material-full-${index}`;
    case PREFLIGHT_CODES.DESIGN_OUTSIDE_MATERIAL_PARTIAL:
      return r.objectId ? `design-outside-material-partial-${r.objectId}` : `design-outside-material-partial-${index}`;
    case PREFLIGHT_CODES.DESIGN_OUTSIDE_BED:
      return r.objectId ? `design-outside-bed-${r.objectId}` : `design-outside-bed-${index}`;
    case PREFLIGHT_CODES.TEXT_FONT_TOO_SMALL:
      return r.objectId ? `design-text-small-${r.objectId}` : `design-text-small-${index}`;
    case PREFLIGHT_CODES.TEXT_EMPTY:
      return r.objectId ? `design-text-empty-${r.objectId}` : `design-text-empty-${index}`;
    case PREFLIGHT_CODES.ENGRAVE_FILL_TOO_SMALL:
      return r.objectId ? `design-engrave-small-fill-${r.objectId}` : `design-engrave-small-fill-${index}`;
    case PREFLIGHT_CODES.IMAGE_MISSING_RASTER:
      return r.objectId ? `design-image-missing-raster-data-${r.objectId}` : `design-image-missing-raster-data-${index}`;
    case PREFLIGHT_CODES.IMAGE_ROTATED_SKEWED:
      return r.objectId ? `design-image-rotated-${r.objectId}` : `design-image-rotated-${index}`;
    case PREFLIGHT_CODES.SETTINGS_CUT_OVERBURN:
      return r.layerId ? `settings-overburn-${r.layerId}` : `settings-overburn-${index}`;
    case PREFLIGHT_CODES.LAYER_OUTPUT_SUMMARIES:
      return 'layer-output-summaries';
    default:
      return r.code || `preflight-${index}`;
  }
}

function legacyFix(r: PreflightResult): string | undefined {
  if (!r.fix) return undefined;
  if (r.code === PREFLIGHT_CODES.MACHINE_DISCONNECTED) return 'Click Connect in the toolbar';
  return r.fix.label;
}

function toLegacyIssue(r: PreflightResult, i: number): PreflightIssue {
  const id = legacyIssueId(r, i);
  const severity: IssueSeverity = r.severity === 'error' ? 'blocker' : r.severity;
  const title =
    r.code === PREFLIGHT_CODES.LAYER_OUTPUT_SUMMARIES
      ? 'Layer laser settings (output layers)'
      : (r.message.split('. ')[0] || r.message).trim() || r.code;
  return {
    id,
    severity,
    title,
    detail: r.message,
    fix: legacyFix(r),
    category: categorizeCode(r.code),
  };
}

/**
 * UI-facing entry point. Runs the preflight engine and returns a scored summary
 * with legacy-shaped issues ready for rendering.
 */
export function runPreflightSummary(
  scene: Scene,
  gcode: string | null,
  machineState: MachineState | null,
  bedWidth: number,
  bedHeight: number,
  machinePlanBounds?: { minX: number; minY: number; maxX: number; maxY: number } | null,
  /** When set, GRBL $22 from the connected controller (homing cycle enabled in firmware). */
  firmwareHomingFromMachine?: boolean,
  /**
   * T1-32: when set, GRBL $32 from the connected controller (true = laser dynamic mode,
   * false = CNC/spindle mode). Drives the MACHINE_LASER_MODE_DISABLED check.
   */
  firmwareLaserModeFromMachine?: boolean,
  /**
   * T1-33: when set, GRBL $30 from the connected controller (controller-reported max
   * spindle / PWM ceiling). Drives the MACHINE_MAXSPINDLE_MISMATCH check that catches
   * profile-vs-controller divergence (over-power risk).
   */
  firmwareMaxSpindleFromMachine?: number,
  /**
   * T1-25: when set, the controller's connect-time safe-state verdict. A
   * non-null reason raises `MACHINE_UNSAFE_AT_CONNECT` as a blocking
   * preflight error so the user can't start a job against a controller
   * that was in alarm / run / hold / check, had residual spindle, or
   * never reported status at all.
   */
  firmwareUnsafeAtConnect?:
    | 'alarm'
    | 'run'
    | 'hold'
    | 'check'
    | 'no-status-response'
    | 'unsafe-residual-spindle'
    | null,
): PreflightSummary {
  const activeProfile = getActiveProfile();
  const preflightBedWidthMm = bedWidth > 0 ? bedWidth : 300;
  const preflightBedHeightMm = bedHeight > 0 ? bedHeight : 300;
  const profile =
    activeProfile ??
    {
      ...createBlankProfile('Bed (scene)'),
      bedWidth: preflightBedWidthMm,
      bedHeight: preflightBedHeightMm,
    };

  const ctx: PreflightContext = {
    scene,
    profile,
    preflightBedWidthMm,
    preflightBedHeightMm,
    optimizeOrderEnabled: scene.compileOptions?.optimizeOrder !== false,
    connectedToMachine: machineState != null,
    machineStatus: machineState?.status ?? null,
    machineAlarmCode: machineState?.alarmCode ?? null,
    hasGcode: gcode != null && gcode.length > 0,
    machinePlanBounds: machinePlanBounds ?? null,
    gcodeTravelScan: !machinePlanBounds && gcode ? gcode : null,
    outputUsesM4: gcode != null && /\bM4\b/i.test(gcode),
    gcodeHeaderPreview: profile.gcodeHeaderTemplate?.trim() || undefined,
    liveMachineInfo: {
      bedWidthMm: bedWidth > 0 ? bedWidth : undefined,
      bedHeightMm: bedHeight > 0 ? bedHeight : undefined,
      ...(typeof firmwareHomingFromMachine === 'boolean' ? { homingEnabled: firmwareHomingFromMachine } : {}),
      ...(typeof firmwareLaserModeFromMachine === 'boolean' ? { laserMode: firmwareLaserModeFromMachine } : {}),
      ...(typeof firmwareMaxSpindleFromMachine === 'number' && firmwareMaxSpindleFromMachine > 0
        ? { maxSpindle: firmwareMaxSpindleFromMachine }
        : {}),
      ...(firmwareUnsafeAtConnect !== undefined ? { unsafeAtConnect: firmwareUnsafeAtConnect } : {}),
    },
  };

  const results = runPreflight(ctx);
  const issues = results.map(toLegacyIssue);

  const blockers = issues.filter(x => x.severity === 'blocker').length;
  const warnings = issues.filter(x => x.severity === 'warning').length;
  const infos = issues.filter(x => x.severity === 'info').length;

  let score = 100;
  score -= blockers * 30;
  score -= warnings * 10;
  score -= infos * 2;
  score = Math.max(0, Math.min(100, score));
  if (blockers > 0) score = Math.min(score, 40);

  return { score, issues, blockers, warnings, canStart: blockers === 0 };
}

function ensureNoCompiledOutputIssue(ctx: PreflightContext, out: PreflightResult[]): void {
  if (ctx.connectedToMachine == null) return;
  if (ctx.machinePlanBounds) return;
  if (ctx.hasGcode) return;
  if (out.some(r => r.code === PREFLIGHT_CODES.NO_GCODE)) return;
  out.push({
    severity: 'error',
    code: PREFLIGHT_CODES.NO_GCODE,
    message: 'No G-code generated. Add objects and connect to generate output.',
  });
}

function sortBySeverity(results: PreflightResult[]): PreflightResult[] {
  const order: Record<PreflightSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  return [...results].sort((a, b) => order[a.severity] - order[b.severity]);
}
