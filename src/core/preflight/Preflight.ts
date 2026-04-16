/**
 * @copyright (c) 2025 LaserForge. All rights reserved.
 */
import type { DeviceProfile } from '../devices/DeviceProfile';
import type { Scene } from '../scene/Scene';
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
}

export function runPreflight(ctx: PreflightContext): PreflightResult[] {
  const results: PreflightResult[] = [];
  runSceneChecks(ctx, results);
  runBoundsChecks(ctx, results);
  runLayerChecks(ctx, results);
  runMachineChecks(ctx, results);
  runTemplateChecks(ctx, results);
  runRasterChecks(ctx, results);
  runOptimizationChecks(ctx, results);
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
