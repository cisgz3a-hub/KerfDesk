/**
 * @copyright (c) 2025 LaserForge. All rights reserved.
 */
import { createBlankProfile, getActiveProfile, type DeviceProfile } from '../devices/DeviceProfile';

const NEGATIVE_COORD_SETTINGS_HINT =
  " If your machine legitimately supports negative workspace, enable 'Allow negative workspace coordinates' in Machine settings.";

function negativeCoordPreflightSeverity(profile: DeviceProfile | null | undefined): 'error' | 'warning' {
  return profile?.allowsNegativeWorkspace === true ? 'warning' : 'error';
}
import type { Scene } from '../scene/Scene';
import { getOutputLayers } from '../scene/Scene';
import type { MachineState, MachineStatus } from '../../controllers/ControllerInterface';
import type { SceneObject } from '../scene/SceneObject';
import { computeObjectBounds } from '../../geometry/bounds';

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
  LONG_JOB: 'LONG_JOB',
  BED_SIZE_MISMATCH: 'BED_SIZE_MISMATCH',
  HIDDEN_LAYER_HAS_OBJECTS: 'HIDDEN_LAYER_HAS_OBJECTS',
  EMPTY_LAYER: 'EMPTY_LAYER',
  CALIBRATION_NOT_MONOTONIC: 'CALIBRATION_NOT_MONOTONIC',
  OPTIMIZE_ORDER_OFF: 'OPTIMIZE_ORDER_OFF',
  SMART_OVERSCAN_OFF_FAST: 'SMART_OVERSCAN_OFF_FAST',
  ACCEL_AWARE_OFF_RASTER: 'ACCEL_AWARE_OFF_RASTER',
  MACHINE_ALARM: 'MACHINE_ALARM',
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
    gcodeHeaderPreview: profile.gcodeHeaderTemplate?.trim() || undefined,
    liveMachineInfo: {
      bedWidthMm: bedWidth > 0 ? bedWidth : undefined,
      bedHeightMm: bedHeight > 0 ? bedHeight : undefined,
      ...(typeof firmwareHomingFromMachine === 'boolean' ? { homingEnabled: firmwareHomingFromMachine } : {}),
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

function runMachineStateChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  if (ctx.connectedToMachine === false) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MACHINE_DISCONNECTED,
      message: 'Not connected to a machine. Connect to a laser or use the simulator.',
    });
  }

  if (ctx.connectedToMachine === true && ctx.machineStatus == null) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MACHINE_DISCONNECTED,
      message: 'Not connected to a machine',
    });
  }

  const st = ctx.machineStatus;
  if (st == null) return;

  if (st === 'alarm') {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MACHINE_ALARM,
      message: `Machine in ALARM state${ctx.machineAlarmCode != null ? ` (code ${ctx.machineAlarmCode})` : ''}. Unlock with $X before starting.`,
    });
  }
  if (st === 'hold') {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MACHINE_HOLD,
      message: 'Machine is paused. Resume or stop before starting a new job.',
    });
  }
  if (st === 'run') {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MACHINE_RUNNING,
      message: 'A job is already running. Wait for it to finish or stop it.',
    });
  }
  if (st === 'homing') {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MACHINE_HOMING,
      message: 'Machine is homing. Wait for homing to complete.',
    });
  }
  if (
    st !== 'idle' &&
    st !== 'alarm' &&
    st !== 'hold' &&
    st !== 'run' &&
    st !== 'homing'
  ) {
    out.push({
      severity: 'warning',
      code: PREFLIGHT_CODES.MACHINE_NOT_IDLE,
      message: `Machine state is ${st}. Expected idle when starting a job.`,
    });
  }
  if (
    ctx.connectedToMachine === true &&
    !ctx.hasGcode &&
    st === 'idle' &&
    !ctx.machinePlanBounds
  ) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.NO_GCODE,
      message: 'No G-code compiled. Update the design or recompile.',
    });
  }
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

function hasUsableObjectBounds(bounds: ReturnType<typeof computeObjectBounds>): boolean {
  return Number.isFinite(bounds.minX) && Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.minY) && Number.isFinite(bounds.maxY) &&
    bounds.maxX > bounds.minX && bounds.maxY > bounds.minY;
}

function isObjectOutsideMaterial(
  obj: SceneObject,
  material: { x: number; y: number; width: number; height: number },
): { outside: boolean; partial: boolean } {
  const bounds = computeObjectBounds(obj);
  if (!hasUsableObjectBounds(bounds)) return { outside: false, partial: false };

  const matMinX = material.x;
  const matMinY = material.y;
  const matMaxX = material.x + material.width;
  const matMaxY = material.y + material.height;

  const fullyOutside =
    bounds.maxX < matMinX ||
    bounds.minX > matMaxX ||
    bounds.maxY < matMinY ||
    bounds.minY > matMaxY;

  if (fullyOutside) return { outside: true, partial: false };

  const partiallyOutside =
    bounds.minX < matMinX ||
    bounds.maxX > matMaxX ||
    bounds.minY < matMinY ||
    bounds.maxY > matMaxY;

  return { outside: false, partial: partiallyOutside };
}

function isObjectOutsideBed(
  obj: SceneObject,
  bed: { width: number; height: number },
): boolean {
  const bounds = computeObjectBounds(obj);
  if (!hasUsableObjectBounds(bounds)) return false;
  return (
    bounds.minX < 0 ||
    bounds.minY < 0 ||
    bounds.maxX > bed.width ||
    bounds.maxY > bed.height
  );
}

function runDesignOutputLayerChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  const { scene } = ctx;
  if (scene.objects.length === 0) return;

  const outputLayers = getOutputLayers(scene);
  const outputLayerIds = new Set(outputLayers.map(l => l.id));
  const outputObjects = scene.objects.filter(o => o.visible && outputLayerIds.has(o.layerId));

  if (outputObjects.length === 0) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.DESIGN_NO_OUTPUT,
      message:
        'No objects on output layers — nothing will be sent to the laser. Objects are hidden, on hidden layers, or on layers excluded from output.',
    });
  }

  if (scene.material && scene.material.enabled !== false) {
    const mat = scene.material;
    for (const obj of outputObjects) {
      const { outside, partial } = isObjectOutsideMaterial(obj, mat);
      if (outside) {
        out.push({
          severity: 'error',
          code: PREFLIGHT_CODES.DESIGN_OUTSIDE_MATERIAL_FULL,
          message: `Object "${obj.name || obj.id}" is completely outside the material area (${mat.width}×${mat.height}mm at ${mat.x}, ${mat.y}).`,
          objectId: obj.id,
        });
      } else if (partial) {
        out.push({
          severity: 'warning',
          code: PREFLIGHT_CODES.DESIGN_OUTSIDE_MATERIAL_PARTIAL,
          message: `Object "${obj.name || obj.id}" extends past the material edge (${mat.width}×${mat.height}mm at ${mat.x}, ${mat.y}).`,
          objectId: obj.id,
        });
      }
    }
  }

  for (const obj of outputObjects) {
    const bed = { width: ctx.preflightBedWidthMm, height: ctx.preflightBedHeightMm };
    if (isObjectOutsideBed(obj, bed)) {
      out.push({
        severity: 'error',
        code: PREFLIGHT_CODES.DESIGN_OUTSIDE_BED,
        message: `Object "${obj.name || obj.id}" is outside the laser bed travel area (${bed.width}×${bed.height}mm).`,
        objectId: obj.id,
      });
    }
  }

  for (const obj of outputObjects) {
    if (obj.geometry.type !== 'text') continue;
    const g = obj.geometry;
    const fontSize = g.fontSize || 10;
    if (fontSize < 4) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.TEXT_FONT_TOO_SMALL,
        message: `Text "${obj.name}" has a very small font (${fontSize.toFixed(1)}mm). Small or thin text may not convert to outlines correctly.`,
        objectId: obj.id,
      });
    }
    if (!g.text?.trim()) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.TEXT_EMPTY,
        message: `Text object "${obj.name}" is empty and will produce no output.`,
        objectId: obj.id,
      });
    }
  }

  for (const obj of outputObjects) {
    const layer = scene.layers.find(l => l.id === obj.layerId);
    if (!layer || layer.settings.mode !== 'engrave') continue;
    const rawIv = Number(layer.settings.fill.interval);
    const interval = Math.max(0.01, Number.isFinite(rawIv) && rawIv > 0 ? rawIv : 0.1);
    const bounds = computeObjectBounds(obj);
    if (!hasUsableObjectBounds(bounds)) continue;
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    const minDim = Math.min(w, h);
    if (minDim < 2 * interval) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.ENGRAVE_FILL_TOO_SMALL,
        message:
          `Object "${obj.name || obj.id}" may be too small for engrave fill (span ≈ ${minDim.toFixed(2)}mm, line spacing ${interval.toFixed(2)}mm).`,
        objectId: obj.id,
        layerId: layer.id,
      });
    }
  }

  for (const obj of outputObjects) {
    if (obj.geometry.type !== 'image') continue;
    const layer = scene.layers.find(l => l.id === obj.layerId);
    if (layer?.settings.mode === 'image') {
      const g = obj.geometry;
      const hasRasterPixels =
        (g.grayscaleData?.length ?? 0) > 0 &&
        (g.grayscaleWidth ?? 0) > 0 &&
        (g.grayscaleHeight ?? 0) > 0;
      if (!hasRasterPixels) {
        out.push({
          severity: 'error',
          code: PREFLIGHT_CODES.IMAGE_MISSING_RASTER,
          message: `Image "${obj.name || obj.id}" has no raster data loaded and cannot produce engraving output.`,
          objectId: obj.id,
        });
      }
    }
    const t = obj.transform;
    const EPS = 0.001;
    if (Math.abs(t.b) > EPS || Math.abs(t.c) > EPS) {
      out.push({
        severity: 'error',
        code: PREFLIGHT_CODES.IMAGE_ROTATED_SKEWED,
        message: `Image "${obj.name || obj.id}" is rotated or skewed — raster compile does not support rotation.`,
        objectId: obj.id,
      });
    }
  }

  for (const layer of outputLayers) {
    if (layer.settings.mode === 'cut' && layer.settings.power.max > 95 && layer.settings.speed < 100) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.SETTINGS_CUT_OVERBURN,
        message: `Layer "${layer.name}" high power + slow speed (${layer.settings.power.max}% at ${layer.settings.speed}mm/min) may cause burning or fire.`,
        layerId: layer.id,
      });
    }
  }

  if (outputLayers.length > 0) {
    const modeLabel = (m: string) =>
      m === 'cut' ? 'Cut' : m === 'engrave' ? 'Engrave' : m === 'score' ? 'Score' : m === 'image' ? 'Image' : m;
    const lines = outputLayers.map(layer => {
      const label = modeLabel(layer.settings.mode);
      const p = layer.settings.passes;
      const passWord = p === 1 ? '1 pass' : `${p} passes`;
      return `${label}: "${layer.name}" — ${layer.settings.power.max}% power, ${layer.settings.speed} mm/min, ${passWord}`;
    });
    out.push({
      severity: 'info',
      code: PREFLIGHT_CODES.LAYER_OUTPUT_SUMMARIES,
      message: `Layer laser settings (output layers). ${lines.join('\n')}`,
    });
  }
}

function runOutputBoundsChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  const bounds = ctx.machinePlanBounds;
  if (!bounds) return;

  const bedW = ctx.liveMachineInfo?.bedWidthMm ?? ctx.profile?.bedWidth;
  const bedH = ctx.liveMachineInfo?.bedHeightMm ?? ctx.profile?.bedHeight;

  if (bounds.minX < -1) {
    const sev = negativeCoordPreflightSeverity(ctx.profile);
    out.push({
      severity: sev,
      code: PREFLIGHT_CODES.OUTPUT_NEGATIVE_X,
      message:
        sev === 'error'
          ? `Job produces negative X (${bounds.minX.toFixed(1)}mm). On front-origin machines this usually means limit-switch hits.${NEGATIVE_COORD_SETTINGS_HINT}`
          : `Output has negative X (${bounds.minX.toFixed(1)}mm). Verify work zero and soft limits.`,
    });
  }
  if (bounds.minY < -1) {
    const sev = negativeCoordPreflightSeverity(ctx.profile);
    out.push({
      severity: sev,
      code: PREFLIGHT_CODES.OUTPUT_NEGATIVE_Y,
      message:
        sev === 'error'
          ? `Job produces negative Y (${bounds.minY.toFixed(1)}mm). On front-origin machines this usually means limit-switch hits.${NEGATIVE_COORD_SETTINGS_HINT}`
          : `Output has negative Y (${bounds.minY.toFixed(1)}mm). Verify work zero and machine limits.`,
    });
  }
  if (bedW != null && bedW > 0 && bounds.maxX > bedW + 1) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.OUTPUT_EXCEEDS_BED_X,
      message: `Output exceeds bed width (${bounds.maxX.toFixed(1)}mm > ${bedW}mm).`,
    });
  }
  if (bedH != null && bedH > 0 && bounds.maxY > bedH + 1) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.OUTPUT_EXCEEDS_BED_Y,
      message: `Output exceeds bed height (${bounds.maxY.toFixed(1)}mm > ${bedH}mm).`,
    });
  }
}

function runGcodeTravelBoundsChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  if (ctx.machinePlanBounds) return;
  const gcode = ctx.gcodeTravelScan;
  if (!gcode) return;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const line of gcode.split('\n')) {
    const xm = line.match(/X([-\d.]+)/);
    const ym = line.match(/Y([-\d.]+)/);
    if (xm) {
      const x = parseFloat(xm[1]);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    if (ym) {
      const y = parseFloat(ym[1]);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  const bedW = ctx.liveMachineInfo?.bedWidthMm ?? ctx.profile?.bedWidth ?? 0;
  const bedH = ctx.liveMachineInfo?.bedHeightMm ?? ctx.profile?.bedHeight ?? 0;

  if (minX < -1) {
    const sev = negativeCoordPreflightSeverity(ctx.profile);
    out.push({
      severity: sev,
      code: PREFLIGHT_CODES.GCODE_TRAVEL_NEGATIVE_X,
      message:
        sev === 'error'
          ? `Job produces negative X (${minX.toFixed(1)}mm) in G-code travel. On front-origin machines this usually means limit-switch hits.${NEGATIVE_COORD_SETTINGS_HINT}`
          : `G-code has negative X (${minX.toFixed(1)}mm). Many setups use negative work coordinates after zeroing; verify work zero and soft limits.`,
    });
  }
  if (minY < -1) {
    const sev = negativeCoordPreflightSeverity(ctx.profile);
    out.push({
      severity: sev,
      code: PREFLIGHT_CODES.GCODE_TRAVEL_NEGATIVE_Y,
      message:
        sev === 'error'
          ? `Job produces negative Y (${minY.toFixed(1)}mm) in G-code travel. On front-origin machines this usually means limit-switch hits.${NEGATIVE_COORD_SETTINGS_HINT}`
          : `G-code has negative Y (${minY.toFixed(1)}mm). Top-left homing often uses negative Y; verify work zero and machine limits.`,
    });
  }
  if (bedW > 0 && maxX > bedW + 1) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.GCODE_TRAVEL_EXCEED_X,
      message: `G-code exceeds bed width (${maxX.toFixed(1)}mm > ${bedW}mm). Objects extend beyond the machine workspace.`,
    });
  }
  if (bedH > 0 && maxY > bedH + 1) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.GCODE_TRAVEL_EXCEED_Y,
      message: `G-code exceeds bed height (${maxY.toFixed(1)}mm > ${bedH}mm). Objects extend beyond the machine workspace.`,
    });
  }
}

function runSceneChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  const hasObjects = ctx.scene.objects.length > 0;
  if (!hasObjects) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.SCENE_EMPTY,
      message: 'Scene has no objects. Add shapes or import a file first.',
    });
    return;
  }

  const hasVisibleObjects = ctx.scene.objects.some(obj => {
    if (!obj.visible) return false;
    const layer = ctx.scene.layers.find(l => l.id === obj.layerId);
    return !!layer && layer.visible !== false;
  });
  if (!hasVisibleObjects) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.NO_VISIBLE_LAYERS,
      message: 'No visible layers contain objects. Enable a layer with content.',
    });
  }

  for (const layer of ctx.scene.layers) {
    const layerObjects = ctx.scene.objects.filter(obj => obj.layerId === layer.id);
    if (layer.visible === false && layerObjects.length > 0) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.HIDDEN_LAYER_HAS_OBJECTS,
        message: `Layer "${layer.name}" is hidden but contains ${layerObjects.length} object(s). They will not be burned.`,
        layerId: layer.id,
      });
    }
    if (layer.visible !== false && layerObjects.length === 0) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.EMPTY_LAYER,
        message: `Layer "${layer.name}" is visible but empty.`,
        layerId: layer.id,
      });
    }
  }
}

function runBoundsChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  const { profile, scene } = ctx;
  if (!profile?.bedWidth || !profile?.bedHeight) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MISSING_BED_SIZE,
      message: 'Bed size unknown. Set it in Settings -> Machine before sending.',
    });
    return;
  }

  const visibleObjects = scene.objects.filter(obj => {
    if (!obj.visible) return false;
    const layer = scene.layers.find(l => l.id === obj.layerId);
    return !!layer && layer.visible !== false;
  });
  if (visibleObjects.length === 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const obj of visibleObjects) {
    const b = computeObjectBounds(obj);
    if (!Number.isFinite(b.minX) || !Number.isFinite(b.maxX) || !Number.isFinite(b.minY) || !Number.isFinite(b.maxY)) continue;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  if (!Number.isFinite(minX)) return;

  if (maxX > profile.bedWidth + 0.01 || maxY > profile.bedHeight + 0.01) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.OUT_OF_BOUNDS_MAX,
      message: `Scene extends past bed (${maxX.toFixed(1)}x${maxY.toFixed(1)}mm > ${profile.bedWidth}x${profile.bedHeight}mm).`,
      fix: { label: 'Fit to bed', action: { type: 'fitToBed' } },
    });
  }
  if (minX < -0.01 || minY < -0.01) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.OUT_OF_BOUNDS_MIN,
      message: `Scene has content in negative coordinates (${minX.toFixed(1)}, ${minY.toFixed(1)}).`,
      fix: { label: 'Clamp to origin', action: { type: 'clampToOrigin' } },
    });
  }

  if (ctx.liveMachineInfo?.bedWidthMm && ctx.liveMachineInfo?.bedHeightMm) {
    const tol = 1;
    if (
      Math.abs(ctx.liveMachineInfo.bedWidthMm - profile.bedWidth) > tol ||
      Math.abs(ctx.liveMachineInfo.bedHeightMm - profile.bedHeight) > tol
    ) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.BED_SIZE_MISMATCH,
        message: `Profile bed size (${profile.bedWidth}x${profile.bedHeight}mm) does not match connected machine (${ctx.liveMachineInfo.bedWidthMm}x${ctx.liveMachineInfo.bedHeightMm}mm).`,
      });
    }
  }
}

function runLayerChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  const { profile, scene } = ctx;
  const maxSpindle = profile?.maxSpindle ?? 1000;
  const maxRate = Math.max(profile?.maxRateX ?? profile?.maxFeedRate ?? 12000, profile?.maxRateY ?? profile?.maxFeedRate ?? 12000);

  for (const layer of scene.layers) {
    if (layer.visible === false || layer.output === false) continue;
    const layerObjects = scene.objects.filter(obj => obj.layerId === layer.id && obj.visible);
    if (layerObjects.length === 0) continue;

    if (layer.settings.power.max <= 0) {
      out.push({
        severity: 'error',
        code: PREFLIGHT_CODES.LAYER_POWER_ZERO,
        message: `Layer "${layer.name}" has power 0 - nothing will be burned.`,
        layerId: layer.id,
        fix: { label: 'Set power to 50%', action: { type: 'setLayerPower', layerId: layer.id, power: maxSpindle * 0.5 } },
      });
    } else if (layer.settings.power.max > 100) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.LAYER_POWER_HIGH,
        message: `Layer "${layer.name}" power (${layer.settings.power.max}%) exceeds expected max (100%).`,
        layerId: layer.id,
      });
    }

    const speed = layer.settings.speed;
    if (speed === 0) {
      out.push({
        severity: 'error',
        code: PREFLIGHT_CODES.LAYER_SPEED_ZERO,
        message: `Layer "${layer.name}" has speed 0.`,
        layerId: layer.id,
        fix: { label: 'Set speed to 3000', action: { type: 'setLayerSpeed', layerId: layer.id, speed: 3000 } },
      });
    } else if (speed < 0) {
      out.push({
        severity: 'error',
        code: PREFLIGHT_CODES.LAYER_SPEED_NEGATIVE,
        message: `Layer "${layer.name}" has negative speed (${speed}).`,
        layerId: layer.id,
      });
    } else if (speed > maxRate) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.LAYER_SPEED_HIGH,
        message: `Layer "${layer.name}" speed (${speed}) exceeds machine max rate (${maxRate}).`,
        layerId: layer.id,
      });
    } else if (speed < 100) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.LAYER_SPEED_LOW,
        message: `Layer "${layer.name}" speed (${speed}) is very slow and may overburn.`,
        layerId: layer.id,
      });
    }
  }
}

function runMachineChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  const profile = ctx.profile;
  if (!profile?.maxSpindle) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MISSING_MAX_SPINDLE,
      message: 'Max spindle (S) unknown. Set it in Settings -> Machine.',
    });
  }

  if (profile?.accelAwarePower) {
    const hasAccel =
      (profile.maxAccelX ?? 0) > 0 ||
      (profile.maxAccelY ?? 0) > 0 ||
      (profile.maxAccelMmPerS2 ?? 0) > 0;
    if (!hasAccel) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.ACCEL_AWARE_NO_ACCEL_PARAM,
        message: 'Acceleration-aware power is enabled but no max acceleration is set.',
      });
    }
  }
}

function runTemplateChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  if (!ctx.gcodeHeaderPreview) return;
  if (ctx.profile?.homingEnabled && !/\$H/.test(ctx.gcodeHeaderPreview)) {
    out.push({
      severity: 'warning',
      code: PREFLIGHT_CODES.HOMING_ENABLED_NO_H,
      message: 'Homing is enabled in profile but $H is missing from header template.',
      fix: { label: 'Enable homing in template', action: { type: 'enableHoming' } },
    });
  }

  const homingHPattern = /(^|\s|;)\$H(\s|$|;)/m;
  const headerWantsHoming = homingHPattern.test(ctx.gcodeHeaderPreview);
  const live = ctx.liveMachineInfo;
  if (
    headerWantsHoming &&
    live != null &&
    typeof live.homingEnabled === 'boolean' &&
    live.homingEnabled === false
  ) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.HOMING_REQUESTED_BUT_DISABLED,
      message:
        "Template '$H' requires machine homing to be enabled. Machine reports $22=0. Enable homing in firmware or choose a template without '$H'.",
    });
  }
}

function runRasterChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  const { scene, profile } = ctx;
  const bedWidth = profile?.bedWidth ?? 300;
  let emittedCalibrationWarning = false;

  for (const layer of scene.layers) {
    if (layer.visible === false || layer.output === false) continue;
    if (layer.settings.mode !== 'image' && layer.settings.mode !== 'engrave') continue;

    const layerObjects = scene.objects.filter(obj => obj.layerId === layer.id && obj.visible);
    for (const obj of layerObjects) {
      if (obj.type !== 'image') continue;

      if (layer.settings.smartOverscanEnabled === true) {
        const estimatedOverscan = computeSmartOverscanEstimate(layer.settings.speed, profile);
        const bbox = computeObjectBounds(obj);
        if (Number.isFinite(bbox.maxX) && bbox.maxX + estimatedOverscan > bedWidth) {
          out.push({
            severity: 'warning',
            code: PREFLIGHT_CODES.OVERSCAN_EXCEEDS_BED,
            message: `Smart overscan (${estimatedOverscan.toFixed(1)}mm) on "${layer.name}" may exceed bed width.`,
            layerId: layer.id,
            objectId: obj.id,
            fix: { label: 'Disable smart overscan', action: { type: 'disableSmartOverscan', layerId: layer.id } },
          });
        }
      }
    }

    if (!emittedCalibrationWarning && (profile?.scanningOffsets?.length ?? 0) >= 2) {
      const speeds = (profile?.scanningOffsets ?? []).map(p => p.speedMmPerMin);
      const sorted = [...speeds].sort((a, b) => a - b);
      const isMonotonic = speeds.every((v, i) => v === sorted[i]);
      if (!isMonotonic) {
        out.push({
          severity: 'warning',
          code: PREFLIGHT_CODES.CALIBRATION_NOT_MONOTONIC,
          message: 'Scanning offset calibration points are not in ascending speed order.',
        });
        emittedCalibrationWarning = true;
      }
    }
  }
}

function runOptimizationChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  if (!ctx.optimizeOrderEnabled) {
    const cutObjectCount = countCutObjects(ctx.scene);
    if (cutObjectCount >= 5) {
      out.push({
        severity: 'info',
        code: PREFLIGHT_CODES.OPTIMIZE_ORDER_OFF,
        message: `Optimize order is off. With ${cutObjectCount} cut objects, enabling it can reduce travel time.`,
      });
    }
  }

  for (const layer of ctx.scene.layers) {
    if (layer.visible === false || layer.output === false) continue;
    if (layer.settings.mode === 'image' || layer.settings.mode === 'engrave') {
      if (!layer.settings.smartOverscanEnabled && layer.settings.speed >= 3000) {
        out.push({
          severity: 'info',
          code: PREFLIGHT_CODES.SMART_OVERSCAN_OFF_FAST,
          message: `Layer "${layer.name}" is fast raster without smart overscan.`,
          layerId: layer.id,
        });
      }
      if (!layer.settings.accelAwarePower && layer.settings.mode === 'image') {
        out.push({
          severity: 'info',
          code: PREFLIGHT_CODES.ACCEL_AWARE_OFF_RASTER,
          message: `Layer "${layer.name}" has acceleration-aware power disabled for raster output.`,
          layerId: layer.id,
        });
      }
    }
  }

  if (ctx.estimatedTimeSeconds && ctx.estimatedTimeSeconds > 3600) {
    out.push({
      severity: 'warning',
      code: PREFLIGHT_CODES.LONG_JOB,
      message: `Estimated job time is about ${Math.round(ctx.estimatedTimeSeconds / 60)} minutes.`,
    });
  }
}

function sortBySeverity(results: PreflightResult[]): PreflightResult[] {
  const order: Record<PreflightSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  return [...results].sort((a, b) => order[a.severity] - order[b.severity]);
}

function countCutObjects(scene: Scene): number {
  const cutLayerIds = new Set(
    scene.layers
      .filter(l => l.visible !== false && l.output !== false && l.settings.mode === 'cut')
      .map(l => l.id),
  );
  return scene.objects.filter(obj => obj.visible && cutLayerIds.has(obj.layerId)).length;
}

function computeSmartOverscanEstimate(speedMmPerMin: number, profile: DeviceProfile | null): number {
  const v = speedMmPerMin / 60;
  const a = profile?.maxAccelMmPerS2 ?? profile?.maxAccelX ?? 1000;
  const safety = profile?.accelAwarePower ? 1.1 * 0.3 : 1.1;
  const floor = 0.5;
  return Math.max(((v * v) / (2 * Math.max(a, 1))) * safety, floor);
}
