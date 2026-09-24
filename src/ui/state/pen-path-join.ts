// pen-path-join — where a finished pen path lands in the scene (ADR-380). A
// path that began on an existing open end extends that path, and one that ends
// on another open end joins it (LightBurn's Auto-Join); ending on the far end
// of the path it continued closes that path. The surviving path keeps its own
// object, operation and direction. A join never changes how anything cuts: a
// path whose operation settings, stroke or transform differ is met exactly but
// left separate. Drawn artwork gets an operation of its own, so equal settings
// rather than a shared operation are what make two drawings joinable.
// https://docs.lightburnsoftware.com/2.1/Reference/DrawLines/

import {
  applyTransform,
  captureLayerOperationSettings,
  curveEndpointJoin,
  pathUsesOperation,
  type ColoredPath,
  type CurveSubpath,
  type Layer,
  type Project,
  type SceneObject,
  type ShapeObject,
  type Vec2,
} from '../../core/scene';
import { createPenPath, penNodesToCurve } from '../../core/shapes/pen-path';
import {
  canFinishPenDraft,
  MIN_PEN_NODES_CLOSED,
  type PenDraft,
  type PenEndpointRef,
} from '../workspace/pen-draft';
import { pathSubpathCurves } from '../workspace/pen-snap-geometry';
import {
  editPathObjectSubpaths,
  type PenJoinableObject,
  type PenSubpathEdit,
} from './pen-path-edit';
import {
  curveBetweenSpaces,
  isInvertibleTransform,
  mapCurvePoints,
  sameTransform,
  sceneToLocal,
} from './pen-path-space';

export type PenCommitPlan =
  | { readonly kind: 'new-shape'; readonly shape: ShapeObject }
  | {
      readonly kind: 'merge';
      // Edited objects by id; null deletes an object whose only path was joined.
      readonly replacements: ReadonlyMap<string, SceneObject | null>;
      readonly selectId: string;
    };

type EndpointTarget = {
  readonly object: PenJoinableObject;
  readonly ref: PenEndpointRef;
  readonly curve: CurveSubpath;
};

type JoinContext = {
  readonly layers: ReadonlyArray<Layer>;
  // Objects another object refers to (image masks, path-text guides).
  readonly referenced: ReadonlySet<string>;
};

// The pieces laid end to end, in drawing order, in the survivor's coordinates.
type MergePieces = {
  // The continued path, oriented to end where the new segments start.
  readonly head: CurveSubpath | null;
  // The joined path, oriented to start where the new segments end.
  readonly tail: CurveSubpath | null;
  readonly closes: boolean;
  // A joined path whose subpath moves into the survivor.
  readonly absorbed: EndpointTarget | null;
  // Drawing order runs against the survivor's own direction.
  readonly reversed: boolean;
};

const ENDPOINT_MATCH_MM = 1e-6;

/** Paths the pen may continue or join: unlocked pen drawings and path artwork. */
export function isPenJoinableObject(object: SceneObject): object is PenJoinableObject {
  if (object.locked === true) return false;
  // A tab sits at a fraction of its path's length; growing the path would
  // silently move it, so tabbed artwork is never extended.
  if ((object.cncTabAnchors?.length ?? 0) > 0) return false;
  if (!isInvertibleTransform(object.transform)) return false;
  if (object.kind === 'imported-svg' || object.kind === 'traced-image') return true;
  return object.kind === 'shape' && object.spec.kind === 'polyline';
}

export function planPenCommit(args: {
  readonly project: Project;
  readonly draft: PenDraft;
  readonly closed: boolean;
  readonly joinTo?: PenEndpointRef;
  readonly id: string;
  readonly color: string;
}): PenCommitPlan | null {
  if (!canFinishPenDraft(args.draft, args.closed)) return null;
  const host = args.closed ? null : resolveEndpoint(args.project, args.draft.continues);
  const target = args.closed ? null : resolveEndpoint(args.project, args.joinTo);
  // The end a path continued from is never also the end it joins.
  const joined = target !== null && host !== null && sameEnd(host.ref, target.ref) ? null : target;
  const merged =
    host === null && joined === null
      ? null
      : planMerge(args.draft, host, joined, {
          layers: args.project.scene.layers,
          referenced: referencedObjectIds(args.project),
        });
  if (merged !== null) return merged;
  const shape = createPenPath({
    id: args.id,
    color: args.color,
    nodes: args.draft.nodes,
    closed: args.closed,
  });
  return shape === null ? null : { kind: 'new-shape', shape };
}

function resolveEndpoint(project: Project, ref: PenEndpointRef | undefined): EndpointTarget | null {
  if (ref === undefined) return null;
  const object = project.scene.objects.find((candidate) => candidate.id === ref.objectId);
  if (object === undefined || !isPenJoinableObject(object)) return null;
  const path = object.paths[ref.pathIndex];
  const curve = path === undefined ? undefined : pathSubpathCurves(path)[ref.curveIndex];
  if (curve === undefined || curve.closed || curve.segments.length === 0) return null;
  const scene = applyTransform(
    ref.end === 'start' ? curve.start : curveEnd(curve),
    object.transform,
  );
  if (Math.hypot(scene.x - ref.point.x, scene.y - ref.point.y) > ENDPOINT_MATCH_MM) return null;
  return { object, ref, curve };
}

// The survivor is the path being continued, else the one joined. The pieces
// are laid end to end in drawing order, then turned back to the survivor's
// own direction so its start point, and with it the cut start, stays put.
function planMerge(
  draft: PenDraft,
  host: EndpointTarget | null,
  joined: EndpointTarget | null,
  context: JoinContext,
): PenCommitPlan | null {
  const survivor = host ?? joined;
  const drawnScene = penNodesToCurve(draft.nodes, false);
  if (survivor === null || drawnScene === null) return null;
  const pieces = host === null ? joinOnlyPieces(survivor) : continuedPieces(host, joined, context);
  const drawn = mapCurvePoints(drawnScene, (point) =>
    sceneToLocal(point, survivor.object.transform),
  );
  const combined = layEndToEnd(pieces, drawn);
  const curve = pieces.reversed ? curveEndpointJoin.reverse(combined) : combined;
  return mergePlan(survivor, curve, pieces.absorbed);
}

// Mapping the scene-space nodes into the survivor can wobble in the last bits,
// so the new segments are pinned to the exact end nodes they share.
function layEndToEnd(pieces: MergePieces, drawn: CurveSubpath): CurveSubpath {
  const { head, tail } = pieces;
  // A closing path ends where the continued path starts; a join, where the
  // joined path starts.
  const endAt = pieces.closes ? head : tail;
  const pinned = pinEnds(
    drawn,
    head === null ? null : curveEnd(head),
    endAt === null ? null : endAt.start,
  );
  const segments = [...(head?.segments ?? []), ...pinned.segments, ...(tail?.segments ?? [])];
  return {
    start: head === null ? pinned.start : head.start,
    segments,
    closed: pieces.closes && segments.length >= MIN_PEN_NODES_CLOSED,
  };
}

function joinOnlyPieces(joined: EndpointTarget): MergePieces {
  return {
    head: null,
    tail: orient(joined, 'start'),
    closes: false,
    absorbed: null,
    reversed: joined.ref.end === 'end',
  };
}

function continuedPieces(
  host: EndpointTarget,
  joined: EndpointTarget | null,
  context: JoinContext,
): MergePieces {
  const base = {
    head: orient(host, 'end'),
    tail: null,
    closes: false,
    absorbed: null,
    reversed: host.ref.end === 'start',
  };
  if (joined === null) return base;
  if (sameSubpath(host.ref, joined.ref)) return { ...base, closes: true };
  const tail = absorbableCurve(host, joined, context);
  return tail === null ? base : { ...base, tail, absorbed: joined };
}

function mergePlan(
  survivor: EndpointTarget,
  curve: CurveSubpath,
  absorbed: EndpointTarget | null,
): PenCommitPlan | null {
  const keep: PenSubpathEdit = {
    pathIndex: survivor.ref.pathIndex,
    curveIndex: survivor.ref.curveIndex,
    curve,
  };
  const drop: PenSubpathEdit | null =
    absorbed === null
      ? null
      : { pathIndex: absorbed.ref.pathIndex, curveIndex: absorbed.ref.curveIndex, curve: null };
  const sameObject = absorbed !== null && absorbed.object.id === survivor.object.id;
  const edited = editPathObjectSubpaths(
    survivor.object,
    drop !== null && sameObject ? [keep, drop] : [keep],
  );
  if (edited === undefined || edited === null) return null;
  const replacements = new Map<string, SceneObject | null>([[survivor.object.id, edited]]);
  if (absorbed !== null && drop !== null && !sameObject) {
    const remaining = editPathObjectSubpaths(absorbed.object, [drop]);
    if (remaining === undefined) return null;
    replacements.set(absorbed.object.id, remaining);
  }
  return { kind: 'merge', replacements, selectId: survivor.object.id };
}

// The joined subpath in the survivor's coordinates, oriented to start at the
// joined end, or null when it may not merge.
function absorbableCurve(
  survivor: EndpointTarget,
  other: EndpointTarget,
  context: JoinContext,
): CurveSubpath | null {
  if (!canAbsorb(survivor, other, context)) return null;
  const local = curveBetweenSpaces(other.curve, other.object.transform, survivor.object.transform);
  if (local === null) return null;
  return other.ref.end === 'start' ? local : curveEndpointJoin.reverse(local);
}

// Another subpath joins the survivor only when the result cuts exactly as both
// did before: equal operation settings and stroke, on artwork nothing else
// refers to.
function canAbsorb(survivor: EndpointTarget, other: EndpointTarget, context: JoinContext): boolean {
  const survivorPath = survivor.object.paths[survivor.ref.pathIndex];
  const otherPath = other.object.paths[other.ref.pathIndex];
  if (survivorPath === undefined || otherPath === undefined) return false;
  const sameObject = other.object.id === survivor.object.id;
  // Artwork that masks an image or guides path text keeps its own identity.
  if (!sameObject && context.referenced.has(other.object.id)) return false;
  const signature = (target: EndpointTarget, path: ColoredPath): string =>
    joinSignature(target.object, path, context.layers);
  if (signature(survivor, survivorPath) !== signature(other, otherPath)) return false;
  // A stroke width is drawn at its object's own scale, so it cannot move into
  // another transform unchanged.
  const sameSpace = sameObject || sameTransform(other.object.transform, survivor.object.transform);
  return sameSpace || (!hasStroke(survivorPath) && !hasStroke(otherPath));
}

function referencedObjectIds(project: Project): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const object of project.scene.objects) {
    if (object.kind === 'raster-image' && object.imageMaskId !== undefined) {
      ids.add(object.imageMaskId);
    }
    if (object.kind === 'text' && object.pathText !== undefined) {
      ids.add(object.pathText.guideObjectId);
    }
  }
  return ids;
}

function joinSignature(
  object: PenJoinableObject,
  path: ColoredPath,
  layers: ReadonlyArray<Layer>,
): string {
  return JSON.stringify({
    operations: layers
      .filter((layer) => pathUsesOperation(object, path, layer))
      .map(operationOutput),
    powerScale: object.powerScale ?? 100,
    override: object.operationOverride ?? null,
    fillRule: path.fillRule ?? 'evenodd',
    strokeWidthMm: path.strokeWidthMm ?? null,
    strokeTransform: path.strokeTransform ?? null,
  });
}

// Everything about an operation that reaches the machine; its id, name and
// colour are presentation.
function operationOutput(layer: Layer): unknown {
  return {
    settings: captureLayerOperationSettings(layer),
    output: layer.output,
    subLayers: layer.subLayers.map((sub) => ({ enabled: sub.enabled, settings: sub.settings })),
    cnc: layer.cnc ?? null,
    material: layer.materialBinding ?? null,
    calibration: layer.scanOffsetCalibrationMode ?? null,
  };
}

function hasStroke(path: ColoredPath): boolean {
  return path.strokeWidthMm !== undefined || path.strokeTransform !== undefined;
}

// The target's subpath turned so the joined end sits at `at`.
function orient(target: EndpointTarget, at: PenEndpointRef['end']): CurveSubpath {
  return target.ref.end === at ? target.curve : curveEndpointJoin.reverse(target.curve);
}

function pinEnds(curve: CurveSubpath, start: Vec2 | null, end: Vec2 | null): CurveSubpath {
  const segments = [...curve.segments];
  const last = segments[segments.length - 1];
  if (end !== null && last !== undefined) segments[segments.length - 1] = { ...last, to: end };
  return { ...curve, start: start ?? curve.start, segments };
}

function sameSubpath(a: PenEndpointRef, b: PenEndpointRef): boolean {
  return a.objectId === b.objectId && a.pathIndex === b.pathIndex && a.curveIndex === b.curveIndex;
}

function sameEnd(a: PenEndpointRef, b: PenEndpointRef): boolean {
  return sameSubpath(a, b) && a.end === b.end;
}

function curveEnd(curve: CurveSubpath): Vec2 {
  return curve.segments[curve.segments.length - 1]?.to ?? curve.start;
}
