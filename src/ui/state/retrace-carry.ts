// Re-trace Original replaces the selected trace in place (ADR-408 Amendment 1).
// The new geometry comes from the source picture, but where the operator put
// the trace and the operations it burns with are theirs, so both carry over:
//
// - Placement: the old trace's offset from its own over-the-source placement
//   is applied to the new trace's over-the-source placement
//   (old transform ∘ old placement⁻¹ ∘ new placement). A trace that still
//   sits on its photo stays registered; a nudged, scaled, turned, mirrored or
//   copied one stays where it was put. Vector traces and Raster scan results
//   (whose bitmap is baked over the source with an identity transform) both
//   go through this.
// - Operations: the new paths rebind to the old trace's operations by colour,
//   as SVG re-import does (ADR-358). Only a colour the old trace lacked, or a
//   changed trace mode (Fill ↔ Line), gets a new operation. Name, power scale
//   and per-operation overrides stay on the object.

import {
  artworkOperationName,
  createArtworkOperation,
  createArtworkOperations,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type Layer,
  type LayerMode,
  type ObjectOperationOverride,
  type RasterImage,
  type Scene,
  type SceneObject,
  type TracedImage,
  type Transform,
} from '../../core/scene';
import { layerSubLayerOperationId } from '../../core/scene/layer';
import {
  freshArtworkMode,
  freshArtworkModeForColor,
  freshArtworkNameForColor,
} from './fresh-artwork-mode';
import { positionTraceOverRasterSource } from './trace-placement';

export type ReplacedTraceResult = TracedImage | RasterImage;

/** The trace result a Re-trace replaces: a vector trace, or a Raster scan result. */
export function replacedTraceResult(
  scene: Scene,
  replaceTraceId: string | undefined,
): ReplacedTraceResult | undefined {
  if (replaceTraceId === undefined) return undefined;
  const found = scene.objects.find((object) => object.id === replaceTraceId);
  if (found?.kind === 'traced-image') return found;
  if (found?.kind === 'raster-image' && found.traceSourceId !== undefined) return found;
  return undefined;
}

/** The new result's transform: its placement over the source plus the
 *  offset the operator gave the replaced result. */
export function carriedRetracePlacement(
  previous: ReplacedTraceResult,
  source: RasterImage,
  nextPlacement: Transform,
  referenceSourceTransform: Transform = source.transform,
): Transform {
  // The offset is measured against the source as the dialog first saw it, so
  // a source moved while the dialog was open takes the trace along with it.
  const reference = { ...source, transform: referenceSourceTransform };
  return carryOffset(previous.transform, placementOverSource(previous, reference), nextPlacement);
}

// A vector trace registers through its own trace grid; a Raster scan result
// is baked into scene space over the source, so its placement is identity.
function placementOverSource(previous: ReplacedTraceResult, source: RasterImage): Transform {
  return previous.kind === 'traced-image'
    ? positionTraceOverRasterSource(source, previous).transform
    : IDENTITY_TRANSFORM;
}

/** current ∘ oldPlacement⁻¹ ∘ newPlacement, as a Transform. */
export function carryOffset(
  current: Transform,
  oldPlacement: Transform,
  newPlacement: Transform,
): Transform {
  if (sameTransform(current, oldPlacement)) return newPlacement;
  if (sameFrame(oldPlacement, newPlacement)) {
    // Only the trace grid's scale differs, so oldPlacement⁻¹ ∘ newPlacement is
    // a local scale and composes exactly, keeping the operator's own flags.
    return {
      ...current,
      scaleX: current.scaleX * (newPlacement.scaleX / oldPlacement.scaleX),
      scaleY: current.scaleY * (newPlacement.scaleY / oldPlacement.scaleY),
    };
  }
  const matrix = multiply(
    multiply(toMatrix(current), invert(toMatrix(oldPlacement))),
    toMatrix(newPlacement),
  );
  return fromMatrix(matrix, current.mirrorX);
}

function sameTransform(a: Transform, b: Transform): boolean {
  return sameFrame(a, b) && a.scaleX === b.scaleX && a.scaleY === b.scaleY;
}

function sameFrame(a: Transform, b: Transform): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.rotationDeg === b.rotationDeg &&
    a.mirrorX === b.mirrorX &&
    a.mirrorY === b.mirrorY &&
    a.scaleX !== 0 &&
    b.scaleX !== 0 &&
    a.scaleY !== 0 &&
    b.scaleY !== 0
  );
}

// Affine [a c e; b d f] for applyTransform: scale → mirror → rotate → translate.
type Matrix = readonly [number, number, number, number, number, number];

function toMatrix(t: Transform): Matrix {
  const rad = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = t.scaleX * (t.mirrorX ? -1 : 1);
  const sy = t.scaleY * (t.mirrorY ? -1 : 1);
  return [cos * sx, sin * sx, -sin * sy, cos * sy, t.x, t.y];
}

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (det === 0 || !Number.isFinite(det)) return [1, 0, 0, 1, 0, 0];
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

// A Transform has no skew. Composing across a kind change (vector ↔ Raster
// scan) over a non-uniformly scaled, turned photo can produce a little; the
// nearest skew-free transform keeps the position, turn and scale the operator
// set rather than snapping back over the photo.
function fromMatrix(m: Matrix, preferMirrorX: boolean): Transform {
  const scaleX = Math.hypot(m[0], m[1]);
  const rad = Math.atan2(m[1], m[0]);
  const along = -Math.sin(rad) * m[2] + Math.cos(rad) * m[3];
  const base: Transform = {
    x: m[4],
    y: m[5],
    scaleX,
    scaleY: Math.abs(along),
    rotationDeg: normalizedDegrees((rad * 180) / Math.PI),
    mirrorX: false,
    mirrorY: along < 0,
  };
  if (!preferMirrorX) return base;
  // The same matrix written with the operator's horizontal mirror.
  return {
    ...base,
    rotationDeg: normalizedDegrees(base.rotationDeg + 180),
    mirrorX: true,
    mirrorY: !base.mirrorY,
  };
}

function normalizedDegrees(degrees: number): number {
  const turned = degrees % 360;
  const positive = turned < 0 ? turned + 360 : turned;
  return Math.abs(positive - 360) < 1e-9 ? 0 : positive;
}

type TraceModeName = NonNullable<TracedImage['traceMode']>;

function traceModeOf(object: TracedImage): TraceModeName {
  return object.traceMode ?? 'filled-contours';
}

/** True when the replaced trace's operations carry over to the new one. */
export function retraceKeepsOperations(
  previous: ReplacedTraceResult | undefined,
  incoming: TracedImage,
): previous is TracedImage {
  return previous?.kind === 'traced-image' && traceModeOf(previous) === traceModeOf(incoming);
}

export type InheritedRetraceOperations = {
  readonly object: TracedImage;
  /** Operations made for colours the old trace lacked. */
  readonly operations: ReadonlyArray<Layer>;
};

/** Rebind `incoming` to `previous`'s operations by colour (ADR-358) and make
 *  a new operation only for a colour whose old operation is missing. */
export function inheritRetraceOperations(
  scene: Scene,
  previous: TracedImage,
  incoming: TracedImage,
  modeForColor: (color: string) => LayerMode | undefined,
): InheritedRetraceOperations {
  const live = liveOperationIds(scene);
  const isLive = (ids: ReadonlyArray<string> | undefined): ids is ReadonlyArray<string> =>
    ids !== undefined && ids.length > 0 && ids.every((id) => live.has(id));
  const objectIds = isLive(previous.operationIds) ? previous.operationIds : undefined;
  const previousPath = pathsByColor(previous.paths);
  const inherited = (path: ColoredPath): ReadonlyArray<string> | undefined => {
    const match = previousPath.get(path.color.toLowerCase());
    if (match === undefined) return undefined;
    if (match.operationIds !== undefined)
      return isLive(match.operationIds) ? match.operationIds : undefined;
    return objectIds;
  };
  const settings = carriedObjectSettings(previous, incoming);
  if (incoming.paths.every((path) => inherited(path) !== undefined)) {
    // Every colour is known: keep the old binding's shape exactly.
    const paths = incoming.paths.map((path) => {
      const own = previousPath.get(path.color.toLowerCase())?.operationIds;
      return own === undefined ? withoutOperationIds(path) : { ...path, operationIds: own };
    });
    return {
      object: {
        ...settings,
        paths,
        ...(objectIds === undefined ? {} : { operationIds: objectIds }),
      },
      operations: [],
    };
  }
  return withNewColourOperations(scene, settings, incoming, inherited, modeForColor);
}

function withNewColourOperations(
  scene: Scene,
  settings: TracedImage,
  dialogTrace: TracedImage,
  inherited: (path: ColoredPath) => ReadonlyArray<string> | undefined,
  modeForColor: (color: string) => LayerMode | undefined,
): InheritedRetraceOperations {
  const incomingPaths = dialogTrace.paths;
  let working = scene;
  const operations: Layer[] = [];
  const created = new Map<string, string>();
  const baseName = artworkOperationName(settings);
  const keptCount = new Set(incomingPaths.flatMap((path) => inherited(path) ?? [])).size;
  const paths = incomingPaths.map((path) => {
    const ids = inherited(path);
    if (ids !== undefined) return { ...path, operationIds: ids };
    const color = path.color.toLowerCase();
    let id = created.get(color);
    if (id === undefined) {
      const mode = modeForColor(color);
      // Made the way a fresh trace makes it: the dialog's fill style included.
      const made = createArtworkOperation(working, dialogTrace, {
        name: `${baseName} ${keptCount + created.size + 1}`,
        ...(mode === undefined ? {} : { mode }),
      });
      id = made.operation.id;
      created.set(color, id);
      operations.push(made.operation);
      working = { ...working, layers: [...working.layers, made.operation] };
    }
    return { ...path, operationIds: [id] };
  });
  const { operationIds: _objectIds, ...withoutObjectIds } = settings;
  return { object: { ...withoutObjectIds, paths }, operations };
}

// The old trace's per-object settings on the new trace. A fill style newly
// picked in the dialog still reaches the kept operations, per object.
function carriedObjectSettings(previous: TracedImage, incoming: TracedImage): TracedImage {
  const { operationOverride: dialogOverride, operationIds: _ids, ...content } = incoming;
  const nextFill = dialogOverride?.fillStyle;
  const changedFill = nextFill !== undefined && nextFill !== previous.traceSettings?.fillStyle;
  const override = changedFill
    ? withFillStyle(previous.operationOverride, nextFill)
    : previous.operationOverride;
  return {
    ...content,
    ...(override === undefined ? {} : { operationOverride: override }),
  };
}

function withFillStyle(
  override: ObjectOperationOverride | undefined,
  fillStyle: NonNullable<ObjectOperationOverride['fillStyle']>,
): ObjectOperationOverride {
  const byOperation = override?.byOperation;
  return {
    ...override,
    fillStyle,
    ...(byOperation === undefined
      ? {}
      : {
          byOperation: Object.fromEntries(
            Object.entries(byOperation).map(([id, entry]) => [id, { ...entry, fillStyle }]),
          ),
        }),
  };
}

/** The operator's own name and power scale, kept by every Re-trace. */
export function withReplacedResultIdentity<T extends SceneObject>(
  object: T,
  previous: ReplacedTraceResult | undefined,
): T {
  if (previous === undefined) return object;
  const { name: _name, powerScale: _powerScale, ...rest } = object;
  return {
    ...rest,
    ...(previous.name === undefined ? {} : { name: previous.name }),
    ...(previous.powerScale === undefined ? {} : { powerScale: previous.powerScale }),
  } as T;
}

function liveOperationIds(scene: Scene): ReadonlySet<string> {
  return new Set(
    scene.layers.flatMap((layer) => [
      layer.id,
      ...layer.subLayers.map((sub) => layerSubLayerOperationId(layer.id, sub.id)),
    ]),
  );
}

function pathsByColor(paths: ReadonlyArray<ColoredPath>): ReadonlyMap<string, ColoredPath> {
  const byColor = new Map<string, ColoredPath>();
  for (const path of paths) {
    const color = path.color.toLowerCase();
    if (!byColor.has(color)) byColor.set(color, path);
  }
  return byColor;
}

function withoutOperationIds(path: ColoredPath): ColoredPath {
  if (path.operationIds === undefined) return path;
  const { operationIds: _ids, ...rest } = path;
  return rest;
}

/** What a vector Re-trace did with the operations, for its toast. */
export function retraceOperationsNote(
  previous: ReplacedTraceResult | undefined,
  incoming: TracedImage,
): string | undefined {
  if (previous === undefined) return undefined;
  if (previous.kind === 'raster-image')
    return 'it changed from a raster scan to vectors, so it has new operations';
  if (!retraceKeepsOperations(previous, incoming))
    return 'the trace mode changed, so it has new operations';
  const known = new Set(previous.paths.map((path) => path.color.toLowerCase()));
  const added = new Set(
    incoming.paths.map((path) => path.color.toLowerCase()).filter((color) => !known.has(color)),
  ).size;
  if (added === 0) return 'it kept its operations';
  return added === 1
    ? '1 new colour has its own new operation'
    : `${added} new colours have their own new operations`;
}

/** A vector trace placed over its source, keeping a replaced result's offset,
 *  name and power scale. Without a live source it stays at its own transform. */
export function placeVectorTrace(
  source: RasterImage | undefined,
  traced: TracedImage,
  previous: ReplacedTraceResult | undefined,
  referenceSourceTransform?: Transform,
): TracedImage {
  if (source === undefined) return withReplacedResultIdentity(traced, previous);
  const placed = positionTraceOverRasterSource(source, traced);
  if (previous === undefined) return placed;
  const transform = carriedRetracePlacement(
    previous,
    source,
    placed.transform,
    referenceSourceTransform,
  );
  return withReplacedResultIdentity({ ...placed, transform }, previous);
}

/** Bind a committed vector trace: a same-mode Re-trace keeps the replaced
 *  trace's operations; anything else gets fresh ones, as a new trace does. */
export function bindVectorTraceOperations(
  scene: Scene,
  trace: TracedImage,
  previous: ReplacedTraceResult | undefined,
): { readonly object: SceneObject; readonly operations: ReadonlyArray<Layer> } {
  const mode = freshArtworkMode(trace);
  const modeForColor = freshArtworkModeForColor(trace);
  if (retraceKeepsOperations(previous, trace)) {
    return inheritRetraceOperations(
      scene,
      previous,
      trace,
      (color) => modeForColor?.(color) ?? mode,
    );
  }
  return createArtworkOperations(scene, trace, {
    mode,
    modeForColor,
    nameForColor: freshArtworkNameForColor(trace),
  });
}

/** A Raster scan result keeping the replaced result's offset and name. Its
 *  operations and power scale are carried by the raster mutation itself. */
export function placeRasterTraceResult(
  raster: RasterImage,
  previous: ReplacedTraceResult | undefined,
  source: RasterImage | undefined,
  referenceSourceTransform?: Transform,
): RasterImage {
  if (previous === undefined || source === undefined) return raster;
  const { name: _name, ...rest } = raster;
  return {
    ...rest,
    transform: carriedRetracePlacement(
      previous,
      source,
      raster.transform,
      referenceSourceTransform,
    ),
    ...(previous.name === undefined ? {} : { name: previous.name }),
  };
}
