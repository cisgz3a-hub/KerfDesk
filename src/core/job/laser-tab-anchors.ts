// Click-placed laser Line tabs (ADR-494, LBG-C05). A LaserTabAnchor has the
// CNC anchor's shape (a normalized position along one source contour), so the
// pure position and projection maths is shared with the CNC tab editor; the
// anchors themselves live in their own SceneObject field and never reach the
// CNC compiler (ADR-101).

import {
  cncTabAnchorPosition,
  projectCncTabAnchor,
  projectPointToPolyline,
} from '../cnc/cnc-tab-anchors';
import { type DeviceProfile, toMachineCoords } from '../devices';
import { pathWalk, pointAtDistance } from '../geometry/path-walk';
import { automaticTabEligibility } from '../geometry/tab-layout';
import {
  applyTransform,
  pathUsesOperation,
  type Layer,
  type LayerOperationSettings,
  type Polyline,
  type SceneObject,
  type Vec2,
} from '../scene';
import type { LaserTabAnchor } from '../scene/scene-object';
import { compilationPolylines } from './compilation-polylines';
import { automaticTabLayoutFor, tabCountForPerimeter } from './operation-cut-extras';

/** Scene position of a placed tab; null once its contour no longer exists. */
export function laserTabAnchorPosition(object: SceneObject, anchor: LaserTabAnchor): Vec2 | null {
  return cncTabAnchorPosition(object, anchor);
}

/** The anchor for a tab at the point of `layerColor`'s closed contours nearest
 * `scenePoint`, with how far that point is from it; null without such a contour. */
export function projectLaserTabAnchor(
  object: SceneObject,
  layerColor: string,
  scenePoint: Vec2,
): { readonly anchor: LaserTabAnchor; readonly distanceMm: number } | null {
  const anchor = projectCncTabAnchor(object, layerColor, scenePoint);
  if (anchor === null) return null;
  const position = laserTabAnchorPosition(object, anchor);
  if (position === null) return null;
  return {
    anchor,
    distanceMm: Math.hypot(position.x - scenePoint.x, position.y - scenePoint.y),
  };
}

/** Where automatic tabs fall on the object's closed `layerColor` contours
 * that have no placed tabs: a canvas hint for the tab tool only. It judges
 * inner shapes among this object's own contours and ignores kerf, so at the
 * edges it can differ from the compiled job. */
export function automaticLaserTabHints(
  object: SceneObject,
  layerColor: string,
  settings: LayerOperationSettings,
): ReadonlyArray<Vec2> {
  if (!('paths' in object) || !settings.tabsEnabled || !(settings.tabSizeMm > 0)) return [];
  const contours: Array<{ readonly key: string; readonly polyline: Polyline }> = [];
  object.paths.forEach((path, pathIndex) => {
    if (path.color !== layerColor) return;
    compilationPolylines(path, object.transform).forEach((polyline, polylineIndex) => {
      const points = polyline.points.map((point) => applyTransform(point, object.transform));
      contours.push({
        key: `${pathIndex}:${polylineIndex}`,
        polyline: { points, closed: polyline.closed },
      });
    });
  });
  const placed = new Set(
    (object.laserTabAnchors ?? []).flatMap((anchor) =>
      anchor.layerColor === layerColor ? [`${anchor.pathIndex}:${anchor.polylineIndex}`] : [],
    ),
  );
  const eligible = automaticTabEligibility(
    contours.map((contour) => contour.polyline),
    settings,
  );
  const layout = automaticTabLayoutFor(settings);
  return contours.flatMap((contour, index) => {
    const walk = pathWalk(contour.polyline);
    if (walk === null || eligible[index] !== true || placed.has(contour.key)) return [];
    const count = tabCountForPerimeter(layout, walk.lengthMm);
    return Array.from({ length: count }, (_unused, tab) =>
      pointAtDistance(walk, ((tab + 0.5) * walk.lengthMm) / count),
    );
  });
}

/** Placed tabs on the paths an operation cuts, across `objects`. */
export function placedLaserTabCount(
  objects: ReadonlyArray<SceneObject>,
  operation: Pick<Layer, 'id' | 'color' | 'bindingOperationId'>,
): number {
  let count = 0;
  for (const object of objects) {
    if (!('paths' in object) || object.laserTabAnchors === undefined) continue;
    for (const anchor of object.laserTabAnchors) {
      const path = object.paths[anchor.pathIndex];
      if (path === undefined || path.color !== anchor.layerColor) continue;
      if (pathUsesOperation(object, path, operation)) count += 1;
    }
  }
  return count;
}

/** Machine-space centres of the tabs placed on one source contour. An anchor
 * counts only while its colour is its path's, as the tab tool shows it. */
export function placedTabPointsForContour(
  object: SceneObject,
  pathIndex: number,
  polylineIndex: number,
  device: DeviceProfile,
): ReadonlyArray<Vec2> {
  const anchors = object.laserTabAnchors;
  if (anchors === undefined || anchors.length === 0 || !('paths' in object)) return [];
  const pathColor = object.paths[pathIndex]?.color;
  return anchors.flatMap((anchor) => {
    if (anchor.pathIndex !== pathIndex || anchor.polylineIndex !== polylineIndex) return [];
    if (anchor.layerColor !== pathColor) return [];
    const position = laserTabAnchorPosition(object, anchor);
    return position === null ? [] : [toMachineCoords(position, device)];
  });
}

/** A kerf offset can merge, split or reorder contours. Each offset contour
 * takes the tabs of the source contour it lies closest to (as CNC toolpaths
 * do), and a tab goes to the nearest offset contour of that source only. */
export function placedTabPointsForKerfContours(
  offsets: ReadonlyArray<Polyline>,
  sources: ReadonlyArray<{ readonly polyline: Polyline; readonly points: ReadonlyArray<Vec2> }>,
): ReadonlyArray<ReadonlyArray<Vec2>> {
  if (!sources.some((source) => source.points.length > 0)) return offsets.map(() => []);
  const owners = offsets.map((offset) =>
    closestIndex(sources.length, (index) => {
      const source = sources[index];
      return source === undefined
        ? Number.POSITIVE_INFINITY
        : contourDistanceSq(offset, source.polyline);
    }),
  );
  return offsets.map((_offset, offsetIndex) => {
    const owner = owners[offsetIndex] ?? -1;
    const points = sources[owner]?.points ?? [];
    return points.filter((point) => {
      const nearest = closestIndex(offsets.length, (index) => {
        const offset = offsets[index];
        return owners[index] !== owner || offset === undefined
          ? Number.POSITIVE_INFINITY
          : (projectPointToPolyline(offset, point)?.distanceSq ?? Number.POSITIVE_INFINITY);
      });
      return nearest === offsetIndex;
    });
  });
}

function closestIndex(count: number, distanceOf: (index: number) => number): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const distance = distanceOf(index);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

function contourDistanceSq(contour: Polyline, source: Polyline): number {
  let distanceSq = Number.POSITIVE_INFINITY;
  const stride = Math.max(1, Math.floor(contour.points.length / 16));
  for (let index = 0; index < contour.points.length; index += stride) {
    const point = contour.points[index];
    if (point === undefined) continue;
    const projection = projectPointToPolyline(source, point);
    if (projection !== null) distanceSq = Math.min(distanceSq, projection.distanceSq);
  }
  return distanceSq;
}
