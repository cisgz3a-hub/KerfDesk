// Display-only camera choreography. Progress, never wall-clock time, selects
// the shot so a paused or stalled job does not keep orbiting.
import type { AxisBounds } from '../../core/gcode-view';
import { boundsExtent, type CameraPlacement, type Vec3 } from './camera-presets';

export type CameraMode = 'manual' | 'follow' | 'auto';
export type CameraTracking = {
  readonly mode: CameraMode;
  readonly point: Vec3 | null;
  readonly progress: number;
};

const SHOTS = [
  { azimuth: -Math.PI / 4, elevation: 0.65 },
  { azimuth: -Math.PI / 2, elevation: 1.35 },
  { azimuth: Math.PI / 5, elevation: 0.5 },
  { azimuth: (Math.PI * 3) / 4, elevation: 0.85 },
  { azimuth: -Math.PI / 4, elevation: 0.65 },
] as const;

export function trackingPlacement(
  tracking: CameraTracking,
  bounds: AxisBounds | null,
  aspect: number,
  reducedMotion = false,
): CameraPlacement | null {
  const { point } = tracking;
  if (tracking.mode === 'manual' || point === null || !finitePoint(point)) return null;
  const progress = Number.isFinite(tracking.progress)
    ? Math.min(1, Math.max(0, tracking.progress))
    : 0;
  const shotIndex =
    tracking.mode === 'auto' && !reducedMotion
      ? Math.min(SHOTS.length - 1, Math.floor(progress * SHOTS.length))
      : 0;
  const shot = SHOTS[shotIndex] ?? SHOTS[0];
  // Leave enough context to recognise the surrounding route, including in a
  // narrow dock. This is a local follow view; Fit restores the whole job.
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const distance = (boundsExtent(bounds) * 1.15) / Math.min(1, safeAspect);
  const horizontal = Math.cos(shot.elevation) * distance;
  return {
    target: point,
    position: {
      x: point.x + Math.cos(shot.azimuth) * horizontal,
      y: point.y + Math.sin(shot.azimuth) * horizontal,
      z: point.z + Math.sin(shot.elevation) * distance,
    },
    up: { x: 0, y: 0, z: 1 },
  };
}

function finitePoint(point: Vec3): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}
