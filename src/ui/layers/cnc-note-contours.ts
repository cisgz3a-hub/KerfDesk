import { collectLayerPolylines } from '../../core/cnc/collect-cnc-contours';
import { CncStrokeGeometryError } from '../../core/cnc/cnc-stroke-geometry-error';
import type { DeviceProfile } from '../../core/devices';
import type { Layer, Polyline, SceneObject } from '../../core/scene';

/** Design notes display the same factual geometry failure that stops compilation. */
export function cncNoteContours(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): { readonly polylines: ReadonlyArray<Polyline>; readonly geometryIssue: string | null } {
  try {
    return { polylines: collectLayerPolylines(objects, layer, device), geometryIssue: null };
  } catch (error) {
    if (error instanceof CncStrokeGeometryError)
      return { polylines: [], geometryIssue: error.message };
    throw error;
  }
}
