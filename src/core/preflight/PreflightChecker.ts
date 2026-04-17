/**
 * Preflight checker — validates a scene + machine state before job execution.
 * Returns a readiness score (0-100%) with categorized issues.
 *
 * Thin adapter over `Preflight.ts`. Maps structured results to the legacy UI shape.
 */

import { type Scene } from '../scene/Scene';
import { type MachineState } from '../../controllers/ControllerInterface';
import {
  runPreflight as runNewPreflight,
  PREFLIGHT_CODES,
  type PreflightContext,
  type PreflightResult as NewPreflightResult,
} from './Preflight';
import { createBlankProfile, getActiveProfile } from '../devices/DeviceProfile';

export type IssueSeverity = 'blocker' | 'warning' | 'info';

export interface PreflightIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  fix?: string;
  category: 'machine' | 'design' | 'settings' | 'output';
}

export interface PreflightResult {
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
  return 'output';
}

function legacyIssueId(r: NewPreflightResult, index: number): string {
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

function legacyFix(r: NewPreflightResult): string | undefined {
  if (!r.fix) return undefined;
  if (r.code === PREFLIGHT_CODES.MACHINE_DISCONNECTED) return 'Click Connect in the toolbar';
  return r.fix.label;
}

function newEngineIssueToLegacy(r: NewPreflightResult, i: number): PreflightIssue {
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

export function runPreflight(
  scene: Scene,
  gcode: string | null,
  machineState: MachineState | null,
  bedWidth: number,
  bedHeight: number,
  /** Machine-space plan bounds (from applyMachineTransform). Preferred over G-code scan. */
  machinePlanBounds?: { minX: number; minY: number; maxX: number; maxY: number } | null,
): PreflightResult {
  const activeProfile = getActiveProfile();
  const profile =
    activeProfile ??
    {
      ...createBlankProfile('Bed (scene)'),
      bedWidth: scene.canvas.width,
      bedHeight: scene.canvas.height,
    };

  const ctx: PreflightContext = {
    scene,
    profile,
    optimizeOrderEnabled: scene.compileOptions?.optimizeOrder !== false,
    connectedToMachine: machineState != null,
    machineStatus: machineState?.status ?? null,
    machineAlarmCode: machineState?.alarmCode ?? null,
    hasGcode: gcode != null && gcode.length > 0,
    machinePlanBounds: machinePlanBounds ?? null,
    gcodeTravelScan: !machinePlanBounds && gcode ? gcode : null,
    liveMachineInfo: {
      bedWidthMm: bedWidth > 0 ? bedWidth : undefined,
      bedHeightMm: bedHeight > 0 ? bedHeight : undefined,
    },
  };

  const newResults = runNewPreflight(ctx);
  const issues = newResults.map((r, i) => newEngineIssueToLegacy(r, i));

  const blockers = issues.filter(x => x.severity === 'blocker').length;
  const warnings = issues.filter(x => x.severity === 'warning').length;
  const infos = issues.filter(x => x.severity === 'info').length;

  let score = 100;
  score -= blockers * 30;
  score -= warnings * 10;
  score -= infos * 2;
  score = Math.max(0, Math.min(100, score));
  if (blockers > 0) score = Math.min(score, 40);

  return {
    score,
    issues,
    blockers,
    warnings,
    canStart: blockers === 0,
  };
}
