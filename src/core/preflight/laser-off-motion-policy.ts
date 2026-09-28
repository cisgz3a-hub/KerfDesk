import { INTENTIONAL_LASER_OFF_MOTION_COMMENT } from '../gcode-comments';
import { effectiveGcodeFeedMmPerMin } from '../gcode/feed-word';
import { parseGcodeWord } from '../invariants';
import { fillScanOverscanMm, imageScanOverscanMm } from '../job/automatic-overscan';
import {
  outputOperationLayers,
  sceneObjectUsesOperation,
  type Project,
  type Scene,
} from '../scene';
import { effectiveOperationForObject } from '../scene/effective-operation';
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

// ADR-495: an operation on automatic overscan runs the runway its speed and the
// machine's acceleration call for, which only the device knows.
export function maxOutputOverscanMm(scene: Scene, device: DeviceProfile): number {
  const outputLayers = scene.layers.flatMap(outputOperationLayers);
  const imageLayers = outputLayers.filter((layer) => layer.mode === 'image');
  // ADR-415: each image operation (and artwork override) sets its own overscan.
  const imageOverscan = Math.max(
    0,
    ...scene.objects.flatMap((object) =>
      object.kind === 'raster-image' && object.role !== 'trace-source'
        ? imageLayers
            .filter((layer) => sceneObjectUsesOperation(object, layer))
            // Along X (0 degrees) is the longest automatic runway; any scan
            // angle the operation adds can only shorten it.
            .map((layer) =>
              imageScanOverscanMm(effectiveOperationForObject(layer, object), device, 0),
            )
        : [],
    ),
  );
  const fillOverscan = Math.max(
    0,
    ...outputLayers
      .filter((layer) => layer.mode === 'fill')
      .map((layer) => longestFillOverscanMm(layer, device)),
    ...scene.objects.flatMap((object) =>
      outputLayers.flatMap((layer) => {
        if (object.kind === 'raster-image' || object.kind === 'relief') return [];
        if (!sceneObjectUsesOperation(object, layer)) return [];
        const effectiveLayer = effectiveOperationForObject(layer, object);
        return effectiveLayer.mode === 'fill'
          ? [longestFillOverscanMm(effectiveLayer, device)]
          : [];
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
    explicitFeed === effectiveGcodeFeedMmPerMin(controlledFeed)
  ) {
    return true;
  }
  return (
    issue.distanceMm <=
    maxOutputOverscanMm(project.scene, project.device) + EMITTED_MOVE_DISTANCE_ROUNDING_TOLERANCE_MM
  );
}

// A hatch along an axis needs the longest automatic runway, and a per-pass
// angle change (ADR-492) can put a pass there whatever the stored angle.
function longestFillOverscanMm(
  layer: Parameters<typeof fillScanOverscanMm>[0],
  device: DeviceProfile,
): number {
  return fillScanOverscanMm({ ...layer, hatchAngleDeg: 0 }, device);
}
