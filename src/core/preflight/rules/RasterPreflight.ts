import type { PreflightContext, PreflightResult } from '../Preflight';
import { PREFLIGHT_CODES } from '../Preflight';
import type { DeviceProfile } from '../../devices/DeviceProfile';
import { computeObjectBounds } from '../../../geometry/bounds';

function computeSmartOverscanEstimate(speedMmPerMin: number, profile: DeviceProfile | null): number {
  const v = speedMmPerMin / 60;
  const a = profile?.maxAccelMmPerS2 ?? profile?.maxAccelX ?? 1000;
  const safety = profile?.accelAwarePower ? 1.1 * 0.3 : 1.1;
  const floor = 0.5;
  return Math.max(((v * v) / (2 * Math.max(a, 1))) * safety, floor);
}

export function runRasterChecks(ctx: PreflightContext, out: PreflightResult[]): void {
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
