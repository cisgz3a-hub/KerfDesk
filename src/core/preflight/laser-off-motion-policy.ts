import { INTENTIONAL_LASER_OFF_MOTION_COMMENT } from '../gcode-comments';
import { parseGcodeWord } from '../invariants';
import { DEFAULT_OVERSCAN_MM } from '../job';
import { layerWithObjectOverride } from '../job/compile-job-object-policy';
import {
  outputOperationLayers,
  sceneObjectUsesOperation,
  type Project,
  type Scene,
} from '../scene';
import type { DeviceProfile } from '../devices';

// Laser G-code coordinates are emitted to three decimal places. Rounding both
// endpoints can change each axis delta by one full 0.001 mm quantum, so the
// maximum possible increase in a two-axis move is sqrt(2) quantums.
const EMITTED_COORDINATE_DECIMAL_PLACES = 3;
const EMITTED_COORDINATE_QUANTUM_MM = 10 ** -EMITTED_COORDINATE_DECIMAL_PLACES;
const EMITTED_MOVE_DISTANCE_ROUNDING_TOLERANCE_MM = Math.SQRT2 * EMITTED_COORDINATE_QUANTUM_MM;

export function controlledLaserOffTravelFeedIssue(device: DeviceProfile): string | null {
  const feed = device.controlledLaserOffTravelFeedMmPerMin;
  if (feed === undefined) return null;
  return Number.isFinite(feed) && feed >= 1 && feed <= device.maxFeed
    ? null
    : `Controlled laser-off seek feed ${String(feed)} is outside 1..${device.maxFeed} mm/min.`;
}

export function maxOutputOverscanMm(scene: Scene): number {
  const outputLayers = scene.layers.flatMap(outputOperationLayers);
  const imageLayers = outputLayers.filter((layer) => layer.mode === 'image');
  const hasImageOutput = scene.objects.some(
    (object) =>
      object.kind === 'raster-image' &&
      object.role !== 'trace-source' &&
      imageLayers.some((layer) => sceneObjectUsesOperation(object, layer)),
  );
  const imageOverscan = hasImageOutput ? DEFAULT_OVERSCAN_MM : 0;
  const fillOverscan = Math.max(
    0,
    ...outputLayers
      .filter((layer) => layer.mode === 'fill')
      .map((layer) => Math.max(0, layer.fillOverscanMm)),
    ...scene.objects.flatMap((object) =>
      outputLayers.flatMap((layer) => {
        if (object.kind === 'raster-image' || object.kind === 'relief') return [];
        if (!sceneObjectUsesOperation(object, layer)) return [];
        const effectiveLayer = layerWithObjectOverride(layer, object);
        return effectiveLayer.mode === 'fill' ? [Math.max(0, effectiveLayer.fillOverscanMm)] : [];
      }),
    ),
  );
  return Math.max(imageOverscan, fillOverscan);
}

export function isConfiguredIntentionalLaserOffMotion(
  project: Project,
  issue: { readonly line: string; readonly distanceMm: number },
): boolean {
  if (!issue.line.includes(INTENTIONAL_LASER_OFF_MOTION_COMMENT)) return false;
  const controlledFeed = project.device.controlledLaserOffTravelFeedMmPerMin;
  const explicitFeed = parseGcodeWord(issue.line, 'F');
  if (
    controlledFeed !== undefined &&
    explicitFeed !== null &&
    explicitFeed === Math.max(1, Math.round(controlledFeed))
  ) {
    return true;
  }
  return (
    issue.distanceMm <=
    maxOutputOverscanMm(project.scene) + EMITTED_MOVE_DISTANCE_ROUNDING_TOLERANCE_MM
  );
}
