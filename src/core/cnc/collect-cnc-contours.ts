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
import { mergeTextObjectContours } from './vcarve-text-union';
import { roundStrokeOutline } from '../geometry/round-stroke-outline';

export function collectLayerPolylines(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): ReadonlyArray<Polyline> {
  return layerPolylinesFromContours(layer, collectLayerContours(objects, layer, device));
}

/**
 * The planner's view of a layer's contours. A V-carve layer resolves each text
 * object's own glyphs with non-zero fill first (ADR-286); every other cut type
 * reads the raw pool exactly as before. This is the one place the rule is
 * applied, so the compiler, the H.7 clearing stage and the design-time notes
 * cannot disagree about where the material is.
 */
export function layerPolylinesFromContours(
  layer: Layer,
  contours: ReadonlyArray<CollectedCncContour>,
): ReadonlyArray<Polyline> {
  if (layer.cnc?.cutType !== 'v-carve') return contours.map((contour) => contour.polyline);
  return mergeTextObjectContours(contours);
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
    const sourcePolylines = flattened.kind === 'ok' ? flattened.polylines : path.polylines;
    const strokeOutline =
      layer.cnc?.cutType === 'v-carve' && path.strokeWidthMm !== undefined
        ? roundStrokeOutline(sourcePolylines, path.strokeWidthMm)
        : null;
    const usesStrokeOutline = strokeOutline !== null && strokeOutline.length > 0;
    const polylines = usesStrokeOutline ? strokeOutline : sourcePolylines;
    polylines.forEach((polyline, polylineIndex) => {
      if (polyline.points.length < 2) return;
      // Clipper can merge and reorder outlined strokes, so its result index no
      // longer identifies the source polyline that owns a persisted tab anchor.
      const manualTabPoints = usesStrokeOutline
        ? []
        : objectTabPoints(object, layer.color, pathIndex, polylineIndex, device);
      out.push({
        polyline: {
          points: polyline.points.map((point) =>
            toMachineCoords(applyTransform(point, object.transform), device),
          ),
          closed: polyline.closed,
        },
        sourceKind: object.kind,
        objectId: object.id,
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
