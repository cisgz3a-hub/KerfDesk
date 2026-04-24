import type { PreflightContext, PreflightResult } from '../Preflight';
import { PREFLIGHT_CODES } from '../Preflight';
import { computeObjectBounds } from '../../../geometry/bounds';
import {
  NEGATIVE_COORD_SETTINGS_HINT,
  negativeCoordPreflightSeverity,
} from './sharedHelpers';

export function runOutputBoundsChecks(ctx: PreflightContext, out: PreflightResult[]): void {
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

export function runGcodeTravelBoundsChecks(ctx: PreflightContext, out: PreflightResult[]): void {
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
