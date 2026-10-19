// Which side of a closed Line contour is scrap, for laser leads with Lead side
// automatic (ADR-626 Amendment 1).
//
// Judged among the scene's contours, not the prepared job's: Cut selected
// graphics, an operation with output off and a disabled sub-layer take
// contours out of the job, and the outline of the part a hole sits in may be
// among them. Every closed contour of every Line operation that burns counts,
// selected or not, output on or off. One that burns nothing (zero power, an
// artwork at 0% power, a power the controller rounds to S0) holds no part.
// Copies count once: one scene contour cut by several operations is one
// contour whatever kerf offset each applies (compile stamps every cut contour
// with the scene contour it comes from, CutSegment.leadSource), and artworks
// drawn on top of each other are matched by shape (laser-lead-copies.ts).
//
// Only an operation that asks for leads says its closed shapes are part edges.
// A contour held only by such shapes is a hole when an odd number hold it and
// an outer contour otherwise. A closed shape on an operation without leads may
// be a part, or only a score line or a sheet border, and parity cannot tell
// which: a contour it holds gets no side, so no leads, and Job Review says so.

import { vectorPowerReachesController } from './job-start-power';
import type { DeviceProfile } from '../devices';
import { effectiveObjectPowerPercent, effectiveOperationForObject } from '../effective-output';
import {
  applyTransform,
  layerFromSubLayer,
  pathUsesOperation,
  sceneObjectUsesOperation,
  type Layer,
  type Scene,
  type SceneObject,
  type Vec2,
} from '../scene';
import { compilationPolylines } from './compilation-polylines';
import { copyRepresentatives, leadOutline, type LeadOutline } from './laser-lead-copies';
import { laserLeadSpecFor } from './laser-lead-settings';
import { properContourAncestors } from './proper-contour-containment';

/** The scene contour a cut contour comes from: one closed polyline of one
 * path of one artwork, as compilationPolylines numbers them. */
export function laserLeadSourceKey(
  objectId: string,
  pathIndex: number,
  polylineIndex: number,
): string {
  return `${objectId}#${pathIndex}:${polylineIndex}`;
}

/** A closed Line contour that may be the edge of a part. */
export type LeadSideContour = {
  readonly key: string;
  readonly points: ReadonlyArray<Vec2>;
  /** Its operation asks for leads, so its closed shapes are part edges. */
  readonly decides: boolean;
  readonly operationName: string;
};

export type LeadSideVerdict = {
  readonly side: 'inside' | 'outside' | 'unknown';
  /** Contours with the same class are copies of one outline. */
  readonly copyClass: number;
  /** For 'unknown': the operation without leads whose shape holds it. */
  readonly aroundName?: string;
};

/** Every closed contour of every burning Line operation in the scene, output
 * scope and output switches aside. */
export function sceneLeadSideContours(
  scene: Pick<Scene, 'layers' | 'objects'>,
  device?: DeviceProfile,
): LeadSideContour[] {
  const contours: LeadSideContour[] = [];
  for (const layer of scene.layers) {
    const operations = [layer, ...layer.subLayers.map((sub) => layerFromSubLayer(layer, sub))];
    for (const operation of operations) {
      for (const object of scene.objects) appendContours(contours, operation, object, device);
    }
  }
  return contours;
}

function appendContours(
  contours: LeadSideContour[],
  operation: Layer,
  object: SceneObject,
  device: DeviceProfile | undefined,
): void {
  if (!('paths' in object) || !sceneObjectUsesOperation(object, operation)) return;
  const effective = effectiveOperationForObject(operation, object);
  if (effective.mode !== 'line') return;
  if (!vectorPowerReachesController(effectiveObjectPowerPercent(effective, object), device)) return;
  const decides = laserLeadSpecFor(effective) !== null;
  for (const [pathIndex, path] of object.paths.entries()) {
    if (!pathUsesOperation(object, path, operation)) continue;
    for (const [index, polyline] of compilationPolylines(path, object.transform).entries()) {
      if (!polyline.closed) continue;
      contours.push({
        key: laserLeadSourceKey(object.id, pathIndex, index),
        points: polyline.points.map((point) => applyTransform(point, object.transform)),
        decides,
        operationName: effective.name,
      });
    }
  }
}

type SideClass = {
  readonly outline: LeadOutline;
  decides: boolean;
  aroundName: string;
};

/** The scrap side of every contour, by key. */
export function leadSideVerdicts(
  contours: ReadonlyArray<LeadSideContour>,
): ReadonlyMap<string, LeadSideVerdict> {
  const byKey = new Map<string, SideClass>();
  for (const contour of contours) {
    const known = byKey.get(contour.key);
    if (known === undefined)
      byKey.set(contour.key, {
        outline: leadOutline(closedPoints(contour.points)),
        decides: contour.decides,
        aroundName: contour.operationName,
      });
    else if (contour.decides) known.decides = true;
  }
  const keyed = [...byKey.values()];
  const representatives = copyRepresentatives(keyed.map((entry) => entry.outline));
  keyed.forEach((entry, index) => {
    const representative = keyed[representatives[index] ?? index];
    if (representative !== undefined && entry.decides) representative.decides = true;
  });
  const unique = keyed.flatMap((_, index) => (representatives[index] === index ? [index] : []));
  const ancestors = properContourAncestors(
    unique.map((index) => ({ polyline: keyed[index]?.outline.points ?? [], closed: true })),
  );
  const at = new Map(unique.map((index, position) => [index, position]));
  const verdicts = new Map<string, LeadSideVerdict>();
  [...byKey.keys()].forEach((key, index) => {
    const copyClass = representatives[index] ?? index;
    const holders = (ancestors[at.get(copyClass) ?? -1] ?? []).map(
      (position) => keyed[unique[position] ?? -1],
    );
    const unknown = holders.find((holder) => holder?.decides !== true);
    verdicts.set(
      key,
      unknown === undefined
        ? { side: holders.length % 2 === 1 ? 'inside' : 'outside', copyClass }
        : { side: 'unknown', copyClass, aroundName: unknown?.aroundName ?? '' },
    );
  });
  return verdicts;
}

function closedPoints(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return points;
  return first.x === last.x && first.y === last.y ? points : [...points, first];
}
