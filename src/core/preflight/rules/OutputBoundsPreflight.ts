import type { PreflightContext, PreflightResult } from '../PreflightContext';
import { PREFLIGHT_CODES } from '../PreflightContext';
import { computeObjectBounds } from '../../../geometry/bounds';
import {
  NEGATIVE_COORD_SETTINGS_HINT,
  negativeCoordPreflightSeverity,
} from './sharedHelpers';
import { physicalBoundsFromWorkBounds } from '../../plan/MachineBounds';

function pushBedSizeMismatchIfNeeded(
  ctx: PreflightContext,
  profileBedWidth: number,
  profileBedHeight: number,
  out: PreflightResult[],
): void {
  if (ctx.liveMachineInfo?.bedWidthMm && ctx.liveMachineInfo?.bedHeightMm) {
    const tol = 1;
    if (
      Math.abs(ctx.liveMachineInfo.bedWidthMm - profileBedWidth) > tol ||
      Math.abs(ctx.liveMachineInfo.bedHeightMm - profileBedHeight) > tol
    ) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.BED_SIZE_MISMATCH,
        message: `Profile bed size (${profileBedWidth}x${profileBedHeight}mm) does not match connected machine (${ctx.liveMachineInfo.bedWidthMm}x${ctx.liveMachineInfo.bedHeightMm}mm).`,
      });
    }
  }
}

function stripGcodeComments(line: string): string {
  return line.replace(/;.*$/, '').replace(/\([^)]*\)/g, '');
}

function readAxisValue(line: string, axis: 'X' | 'Y'): number | null {
  const match = new RegExp(`${axis}\\s*([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))`, 'i').exec(line);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function runOutputBoundsChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  const rawBounds = ctx.machinePlanBounds;
  if (!rawBounds) return;
  const bounds = physicalBoundsFromWorkBounds(
    rawBounds,
    ctx.startMode,
    ctx.workOriginMachinePosition,
  );

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

export function runGcodeTravelBoundsChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  if (ctx.machinePlanBounds) return;
  const gcode = ctx.gcodeTravelScan;
  if (!gcode) return;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const line of gcode.split('\n')) {
    const uncommentedLine = stripGcodeComments(line);
    const x = readAxisValue(uncommentedLine, 'X');
    const y = readAxisValue(uncommentedLine, 'Y');
    if (x != null) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    if (y != null) {
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

export function runBoundsChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  const { profile, scene } = ctx;
  if (!profile?.bedWidth || !profile?.bedHeight) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MISSING_BED_SIZE,
      message: 'Bed size unknown. Set it in Settings -> Machine before sending.',
    });
    return;
  }

  if (ctx.machinePlanBounds) {
    pushBedSizeMismatchIfNeeded(ctx, profile.bedWidth, profile.bedHeight, out);
    return;
  }

  // T1-107: bed-bounds checks must ignore guide-layer objects. Layers
  // with output:false are visible on canvas but explicitly excluded
  // from the burn output.
  const outputObjects = scene.objects.filter(obj => {
    if (!obj.visible) return false;
    const layer = scene.layers.find(l => l.id === obj.layerId);
    return !!layer && layer.visible !== false && layer.output !== false;
  });
  if (outputObjects.length === 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const obj of outputObjects) {
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

  pushBedSizeMismatchIfNeeded(ctx, profile.bedWidth, profile.bedHeight, out);
}
