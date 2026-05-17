/**
 * @copyright (c) 2025 LaserForge. All rights reserved.
 */
import { createBlankProfile, getActiveProfile } from '../devices/DeviceProfile';
import type { Scene } from '../scene/Scene';
import type { ValidatedJobTicket } from '../job/ValidatedJobTicket';
import type { GcodeStartMode } from '../output/GcodeOrigin';
import type { DeviceIdentity, MachineState } from '../../controllers/ControllerInterface';
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
import { runDuplicateGeometryChecks } from './rules/DuplicateGeometryPreflight';
import { runSelfIntersectionChecks } from './rules/SelfIntersectionPreflight';
import { runCompileComplexityChecks } from './rules/CompileComplexityPreflight';
import { runGeometryValidityChecks } from './rules/GeometryValidityPreflight';
import { runOutputGcodeSemanticChecks } from './rules/OutputValidator';
import { checkCapabilityMismatches } from './rules/CapabilityMismatchRules';
import { PREFLIGHT_CODES } from './PreflightContext';
import type { PreflightContext, PreflightResult, PreflightSeverity } from './PreflightContext';

export { PREFLIGHT_CODES } from './PreflightContext';
export type { PreflightContext, PreflightResult, PreflightSeverity, PreflightFix } from './PreflightContext';

export function runPreflight(ctx: PreflightContext): PreflightResult[] {
  const results: PreflightResult[] = [];
  runMachineStateChecks(ctx, results);
  runSceneChecks(ctx, results);
  runGeometryValidityChecks(ctx, results);
  runDesignOutputLayerChecks(ctx, results);
  runOutputBoundsChecks(ctx, results);
  runGcodeTravelBoundsChecks(ctx, results);
  runBoundsChecks(ctx, results);
  runLayerChecks(ctx, results);
  runMachineChecks(ctx, results);
  runCapabilityMismatchChecks(ctx, results);
  runTemplateChecks(ctx, results);
  runGcodeTemplateSemanticValidation(ctx, results);
  runOutputGcodeSemanticChecks(ctx, results);
  runRasterChecks(ctx, results);
  runOptimizationChecks(ctx, results);
  runDuplicateGeometryChecks(ctx, results);
  runSelfIntersectionChecks(ctx, results);
  runCompileComplexityChecks(ctx, results);
  ensureNoCompiledOutputIssue(ctx, results);
  return sortBySeverity(results);
}

function runCapabilityMismatchChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  if (!ctx.profile || !ctx.liveMachineInfo?.deviceIdentity) return;
  for (const finding of checkCapabilityMismatches(ctx.profile, ctx.liveMachineInfo.deviceIdentity)) {
    out.push({
      severity: finding.severity,
      code: finding.code,
      message: `${finding.message} ${finding.fix}`,
    });
  }
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
  if (
    code.includes('LAYER') ||
    code.includes('POWER') ||
    code.includes('SPEED') ||
    code.includes('SETTINGS_') ||
    code.startsWith('Z_AXIS_') ||
    code.startsWith('PROFILE_') ||
    code === 'HOMING_PROFILE_VS_FIRMWARE_MISMATCH'
  ) {
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
    | 'door'
    | 'check'
    | 'no-status-response'
    | 'unsafe-residual-spindle'
    | null,
  startMode: GcodeStartMode = 'absolute',
  savedOriginForPreflight?: { x: number; y: number } | null,
  /**
   * T1-218 (v30 audit #1): when false, the incoming `bedWidth` /
   * `bedHeight` came from `DEFAULT_MACHINE_BED_MM` (the 300mm
   * fallback) rather than from a connected controller or an
   * explicit profile. We synthesize the preflight profile with
   * bedWidth/bedHeight = 0 in that case so the existing
   * `MISSING_BED_SIZE` blocker fires instead of silently letting a
   * phantom 300mm bed authorize motion that could exceed the
   * actual work envelope.
   *
   * Defaults to `true` so the 20+ existing test callers don't
   * change behaviour. Production caller (ConnectionPanelMain)
   * computes the flag via `bedDimensionsKnown(profile,
   * controllerBed)` in PipelineService.
  */
  bedDimensionsKnown: boolean = true,
  compiledOutput?: {
    readonly hasGcode?: boolean;
    readonly outputUsesM4?: boolean;
  },
  firmwareDeviceIdentityFromMachine?: DeviceIdentity | null,
): PreflightSummary {
  const activeProfile = getActiveProfile();
  // T1-218: when the caller signals the bed dimensions are
  // fallback-only, propagate that as zero into the synthesized
  // profile so the MISSING_BED_SIZE rule (OutputBoundsPreflight)
  // triggers. The pre-T1-218 code substituted 300 here too, which
  // hid the unknown-bed state from every downstream rule.
  const preflightBedWidthMm = bedDimensionsKnown && bedWidth > 0 ? bedWidth : 0;
  const preflightBedHeightMm = bedDimensionsKnown && bedHeight > 0 ? bedHeight : 0;
  const profile =
    activeProfile && bedDimensionsKnown
      ? activeProfile
      : {
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
    connectedToMachine:
      machineState != null &&
      machineState.status !== 'disconnected' &&
      machineState.status !== 'connecting',
    machineStatus: machineState?.status ?? null,
    startMode,
    workOriginMachinePosition:
      startMode === 'current'
        ? machineState?.position ?? null
        : startMode === 'savedOrigin'
          ? savedOriginForPreflight ?? null
          : null,
    machineAlarmCode: machineState?.alarmCode ?? null,
    hasGcode: compiledOutput?.hasGcode ?? (gcode != null && gcode.length > 0),
    machinePlanBounds: machinePlanBounds ?? null,
    gcodeTravelScan: !machinePlanBounds && gcode ? gcode : null,
    emittedGcode: gcode,
    outputUsesM4: compiledOutput?.outputUsesM4 ?? (gcode != null && /\bM4\b/i.test(gcode)),
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
      ...(firmwareDeviceIdentityFromMachine != null ? { deviceIdentity: firmwareDeviceIdentityFromMachine } : {}),
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
