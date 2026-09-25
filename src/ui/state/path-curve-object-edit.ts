// Shared plumbing for node-editor commands that change a path's shape or
// topology (ADR-376): find the editable artwork, read its canonical curves
// (promoting a legacy polyline-only path the way saving does), put edited
// subpaths back with a fresh compatibility view and bounds, and keep a pen
// drawing's spec in step. A pen drawing that ends up with more than one
// subpath cannot stay a single-run polyline shape, so it becomes a path object
// with the same id, placement and settings instead of refusing the edit.

import {
  curveNodeCount,
  polylineToCurveSubpath,
  type CncTabAnchor,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type Project,
  type SceneObject,
  type ShapeObject,
  type TracedImage,
} from '../../core/scene';
import type { AppState } from './store';
import type { PathNodeRef } from './path-node-edit-actions';
import { boundsForPaths, materializeCurvePath } from './path-node-edit-geometry';
import { synchronizePolylineShapeGeometry } from './path-node-shape-sync';
import { pushUndo } from './scene-mutations';

export type NodeEditableObject = ImportedSvg | TracedImage | ShapeObject;

/** Where one subpath's replacement lands, as pieces in path order. */
export type SubpathReplacement = {
  readonly pathIndex: number;
  readonly polylineIndex: number;
  readonly pieces: ReadonlyArray<CurveSubpath>;
};

export function nodeEditableObject(project: Project, objectId: string): NodeEditableObject | null {
  const object = project.scene.objects.find((candidate) => candidate.id === objectId);
  if (object === undefined || object.locked === true) return null;
  if (object.kind === 'imported-svg' || object.kind === 'traced-image') return object;
  return object.kind === 'shape' && object.spec.kind === 'polyline' ? object : null;
}

/** Canonical curves of a path; a legacy polyline-only path is promoted. */
export function canonicalCurves(path: ColoredPath): ReadonlyArray<CurveSubpath> {
  return path.curves ?? path.polylines.map(polylineToCurveSubpath);
}

export function canonicalSubpath(
  object: NodeEditableObject,
  pathIndex: number,
  polylineIndex: number,
): CurveSubpath | null {
  const path = object.paths[pathIndex];
  return path === undefined ? null : (canonicalCurves(path)[polylineIndex] ?? null);
}

/** The ref's node in canonical numbering. A legacy ref to the repeated closing
 *  point of a closed polyline names node 0; a legacy ref into a path that
 *  already has curves addresses flattened points, not nodes, and is refused. */
export function canonicalNodeIndex(object: NodeEditableObject, ref: PathNodeRef): number | null {
  const path = object.paths[ref.pathIndex];
  const subpath = canonicalSubpath(object, ref.pathIndex, ref.polylineIndex);
  if (path === undefined || subpath === null || ref.handle !== undefined) return null;
  if (ref.geometry !== 'curve' && path.curves !== undefined) return null;
  const count = curveNodeCount(subpath);
  const index = ref.pointIndex === count && subpath.closed ? 0 : ref.pointIndex;
  return Number.isInteger(index) && index >= 0 && index < count ? index : null;
}

export function curveNodeRef(
  objectId: string,
  pathIndex: number,
  polylineIndex: number,
  pointIndex: number,
): PathNodeRef {
  return { objectId, pathIndex, polylineIndex, pointIndex, geometry: 'curve' };
}

/** Replace one subpath with `pieces`. A path left with no subpaths is dropped;
 *  the artwork's last path cannot be, since deleting the artwork is the
 *  object tool's job. */
export function objectWithSubpathPieces(
  object: NodeEditableObject,
  replacement: SubpathReplacement,
): NodeEditableObject | null {
  const path = object.paths[replacement.pathIndex];
  if (path === undefined) return null;
  const curves = canonicalCurves(path);
  const original = curves[replacement.polylineIndex];
  if (original === undefined) return null;
  const nextCurves = [
    ...curves.slice(0, replacement.polylineIndex),
    ...replacement.pieces,
    ...curves.slice(replacement.polylineIndex + 1),
  ];
  if (nextCurves.length === 0) return objectWithoutPath(object, replacement.pathIndex);
  const same = replacement.pieces.length === 1 && replacement.pieces[0]?.closed === original.closed;
  const shift = replacement.pieces.length - 1;
  return objectWithPathCurves(object, replacement.pathIndex, nextCurves, (anchor) => {
    if (anchor.polylineIndex < replacement.polylineIndex) return anchor;
    if (anchor.polylineIndex > replacement.polylineIndex) {
      return { ...anchor, polylineIndex: anchor.polylineIndex + shift };
    }
    // A tab stays on a contour that kept its topology; one on a contour that
    // was opened or split has nowhere reliable to go.
    return same ? anchor : null;
  });
}

/** Put a path's edited curves back, remapping tab anchors on that path. */
export function objectWithPathCurves(
  object: NodeEditableObject,
  pathIndex: number,
  curves: ReadonlyArray<CurveSubpath>,
  remapAnchor: (anchor: CncTabAnchor) => CncTabAnchor | null,
): NodeEditableObject | null {
  const source = object.paths[pathIndex];
  if (source === undefined) return null;
  const path = materializeCurvePath(source, curves);
  if (path === null) return null;
  const paths = object.paths.map((candidate, index) => (index === pathIndex ? path : candidate));
  const anchored = remapTabAnchors(object, pathIndex, remapAnchor);
  return rebuildNodeEditableObject(anchored, paths);
}

/** New bounds for new paths; a pen drawing keeps its spec in step. */
export function rebuildNodeEditableObject(
  object: NodeEditableObject,
  paths: ReadonlyArray<ColoredPath>,
): NodeEditableObject {
  const bounds = boundsForPaths(paths);
  if (object.kind !== 'shape') return { ...object, paths, bounds };
  return synchronizePolylineShapeGeometry(object, paths, bounds) ?? penDrawingAsPath(object, paths);
}

export function projectWithObject(project: Project, object: SceneObject): Project {
  const objects = project.scene.objects.map((candidate) =>
    candidate.id === object.id ? object : candidate,
  );
  return { ...project, scene: { ...project.scene, objects } };
}

/** One undo step replacing the object; the given nodes become the selection. */
export function committedObjectEdit(
  state: AppState,
  object: SceneObject,
  selectedNodes: ReadonlyArray<PathNodeRef> = [],
): Partial<AppState> {
  return {
    project: projectWithObject(state.project, object),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
    selectedPathNode: selectedNodes.at(-1) ?? null,
    selectedPathNodes: selectedNodes,
  };
}

function objectWithoutPath(
  object: NodeEditableObject,
  pathIndex: number,
): NodeEditableObject | null {
  if (object.paths.length <= 1) return null;
  const paths = object.paths.filter((_path, index) => index !== pathIndex);
  const cncTabAnchors = object.cncTabAnchors?.flatMap((anchor) => {
    if (anchor.pathIndex < pathIndex) return [anchor];
    return anchor.pathIndex === pathIndex ? [] : [{ ...anchor, pathIndex: anchor.pathIndex - 1 }];
  });
  const remapped = cncTabAnchors === undefined ? object : { ...object, cncTabAnchors };
  return rebuildNodeEditableObject(remapped, paths);
}

function remapTabAnchors(
  object: NodeEditableObject,
  pathIndex: number,
  remap: (anchor: CncTabAnchor) => CncTabAnchor | null,
): NodeEditableObject {
  if (object.cncTabAnchors === undefined) return object;
  const cncTabAnchors = object.cncTabAnchors.flatMap((anchor) => {
    if (anchor.pathIndex !== pathIndex) return [anchor];
    const next = remap(anchor);
    return next === null ? [] : [next];
  });
  return { ...object, cncTabAnchors };
}

// Everything that is not pen-drawing specific carries over: id, placement,
// operations, overrides, lock and tabs, so output and selection are unchanged.
function penDrawingAsPath(shape: ShapeObject, paths: ReadonlyArray<ColoredPath>): ImportedSvg {
  const {
    kind: _kind,
    spec: _spec,
    color: _color,
    provenance: _provenance,
    fairingVersion: _fairingVersion,
    paths: _paths,
    bounds: _bounds,
    ...common
  } = shape;
  return {
    ...common,
    kind: 'imported-svg',
    source: 'Shape: polyline (paths)',
    bounds: boundsForPaths(paths),
    paths,
  };
}
