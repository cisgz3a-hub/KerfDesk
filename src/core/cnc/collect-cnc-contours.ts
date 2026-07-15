import { type DeviceProfile, toMachineCoords } from '../devices';
import {
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  applyTransform,
  assertNever,
  flattenColoredPathCurves,
  pathUsesOperation,
  type ColoredPath,
  type Layer,
  type Polyline,
  type SceneObject,
  type Vec2,
} from '../scene';
import { cncTabAnchorPosition } from './cnc-tab-anchors';
import type { CollectedCncContour } from './cnc-manual-tab-mapping';

export function collectLayerPolylines(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): Polyline[] {
  return collectLayerContours(objects, layer, device).map((contour) => contour.polyline);
}

export function collectLayerContours(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): CollectedCncContour[] {
  const out: CollectedCncContour[] = [];
  for (const object of objects) {
    switch (object.kind) {
      case 'imported-svg':
      case 'text':
      case 'traced-image':
      case 'shape':
        appendObjectContours(object, layer, device, out);
        break;
      case 'raster-image':
      case 'relief':
        break;
      default:
        assertNever(object, 'SceneObject');
    }
  }
  return out;
}

function appendObjectContours(
  object: Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }>,
  layer: Layer,
  device: DeviceProfile,
  out: CollectedCncContour[],
): void {
  object.paths.forEach((path, pathIndex) => {
    if (!pathUsesOperation(object, path, layer)) return;
    const flattened = flattenColoredPathCurves(path, {
      toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
      segmentBudget: 100_000,
    });
    const polylines = flattened.kind === 'ok' ? flattened.polylines : path.polylines;
    polylines.forEach((polyline, polylineIndex) => {
      if (polyline.points.length < 2) return;
      const manualTabPoints = objectTabPoints(
        object,
        layer.color,
        pathIndex,
        polylineIndex,
        device,
      );
      out.push({
        polyline: {
          points: polyline.points.map((point) =>
            toMachineCoords(applyTransform(point, object.transform), device),
          ),
          closed: polyline.closed,
        },
        ...(manualTabPoints.length === 0 ? {} : { manualTabPoints }),
      });
    });
  });
}

function objectTabPoints(
  object: SceneObject,
  layerColor: string,
  pathIndex: number,
  polylineIndex: number,
  device: DeviceProfile,
): ReadonlyArray<Vec2> {
  return (object.cncTabAnchors ?? [])
    .filter(
      (anchor) =>
        anchor.layerColor === layerColor &&
        anchor.pathIndex === pathIndex &&
        anchor.polylineIndex === polylineIndex,
    )
    .map((anchor) => cncTabAnchorPosition(object, anchor))
    .filter((point): point is Vec2 => point !== null)
    .map((point) => toMachineCoords(point, device));
}
