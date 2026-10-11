import {
  applyTransform,
  operationIdsForObject,
  sceneLayerVisibility,
  type AABB,
  type Layer,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { transformedBBox } from '../../core/scene/hit-test';
import type { AppState } from '../state/store';
import { resolveObjectDisplay, type VectorSceneObject } from '../workspace/object-display';
import { RemoteFault } from './fault';
import { previewView, strictPreviewCache } from './preview-geometry';
import {
  PreviewUnavailable,
  invalidGeometry,
  previewTooLarge,
  validatedPreviewImageFootprint,
  validatedPreviewObject,
} from './preview-validation';
import { publicIdentifier, remoteBounds } from './projections';
import type { RemoteControlOptions } from './types';
import { fitsRemoteResponse } from './response-budget';

export const SCENE_OBJECT_LIMIT = 200;
// eslint-disable-next-line no-restricted-syntax -- scene DATA: stands in for an unparseable layer colour key (ADR-047).
const FALLBACK_LAYER_COLOR = '#000000';
const DISABLED = {
  status: 'disabled',
  message:
    'Enable artwork previews and text in KerfDesk Settings → Phone & MCP on the PC to share this artwork.',
} as const;

type ScenePath = {
  color: string;
  fill: boolean;
  output: boolean;
  polylines: { closed: boolean; points: string }[];
};
type SceneObjectProjection = {
  id: string;
  kind: string;
  unitId: string;
  operationId?: string;
  editable: boolean;
  bounds: { xMm: number; yMm: number; widthMm: number; heightMm: number };
  paths: ScenePath[];
};
type Resolved = {
  readonly object: VectorSceneObject;
  readonly paths: readonly {
    color: string;
    fill: boolean;
    output: boolean;
    polylines: readonly { closed: boolean; points: Vec2[] }[];
  }[];
};

/** ADR-582: bounded vector geometry behind the existing artwork-sharing opt-in. */
export async function workspaceSceneProjection(
  state: AppState,
  options: RemoteControlOptions,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const active = () => {
    if (signal?.aborted === true) throw new RemoteFault('cancelled');
    return options.canShareArtwork?.() === true;
  };
  if (!active()) return DISABLED;
  await Promise.resolve();
  if (!active()) return DISABLED;
  try {
    return buildScene(state.project);
  } catch (error) {
    if (!(error instanceof PreviewUnavailable)) throw error;
    return { status: 'unavailable', message: error.message };
  }
}

type SceneImageProjection = { id: string; unitId: string; editable: boolean; corners: number[] };

/** Visible artwork split into vectors and image footprints, with their combined extent. */
function collectVisible(project: Project, units: ReadonlyMap<string, string>) {
  const scene = project.scene;
  const layers = sceneLayerVisibility.lookup(scene.layers);
  const budget = { points: 0 };
  const vectors: VectorSceneObject[] = [];
  const images: SceneImageProjection[] = [];
  let extent: AABB | undefined;
  for (const object of scene.objects) {
    if (!sceneLayerVisibility.hasObject(object, layers)) continue;
    if (!publicIdentifier(object.id)) invalidGeometry();
    if (object.kind === 'raster-image') {
      const footprint = validatedPreviewImageFootprint(object, budget);
      for (const point of footprint.corners) extent = union(extent, point);
      images.push({
        id: object.id,
        unitId: units.get(object.id) ?? object.id,
        editable: object.locked !== true,
        corners: footprint.corners.flatMap((point) => [round(point.x), round(point.y)]),
      });
      continue;
    }
    const vector = validatedPreviewObject(object, budget);
    const box = transformedBBox(vector);
    extent = union(union(extent, { x: box.minX, y: box.minY }), { x: box.maxX, y: box.maxY });
    vectors.push(vector);
  }
  return { layers, vectors, images, extent };
}

export function buildScene(project: Project): Record<string, unknown> {
  const scene = project.scene;
  if (scene.objects.length > SCENE_OBJECT_LIMIT || scene.layers.length > SCENE_OBJECT_LIMIT)
    throw new PreviewUnavailable(
      'This workspace is too large for the remote canvas. View it on the PC.',
    );
  const units = unitIds(project);
  const { layers, vectors, images, extent } = collectVisible(project, units);
  const bed = bedSize(project);
  const area = extent ?? { minX: 0, minY: 0, maxX: bed.widthMm, maxY: bed.heightMm };
  const resolved = resolveDisplays(vectors, layers, area);
  const base = Math.max(0.01, Math.max(area.maxX - area.minX, area.maxY - area.minY) / 8000);
  for (const factor of [1, 2, 4, 8, 16, 32]) {
    const objects = resolved.map((item) => projectObject(item, units, scene.layers, base * factor));
    const result = {
      status: 'ready',
      bed,
      extent: {
        xMm: area.minX,
        yMm: area.minY,
        widthMm: Math.max(1, area.maxX - area.minX),
        heightMm: Math.max(1, area.maxY - area.minY),
      },
      toleranceMm: base * factor,
      objects,
      images,
      totalObjects: scene.objects.length,
      ...(images.length > 0
        ? { message: 'Image artwork is shown as its placement frame; pixels stay on the PC.' }
        : {}),
    };
    if (fitsRemoteResponse(result)) return result;
  }
  return previewTooLarge();
}

function resolveDisplays(
  vectors: readonly VectorSceneObject[],
  layers: ReadonlyMap<string, Layer>,
  area: AABB,
): Resolved[] {
  const view = previewView(area, 4096);
  const cache = strictPreviewCache();
  return vectors.map((object) => {
    const display = resolveObjectDisplay(object, layers, view, cache, 'design');
    if (display.isSimplified) previewTooLarge();
    return {
      object,
      paths: display.paths.map((path) => ({
        color: path.paint.color.toLowerCase(),
        fill: path.paint.kind === 'fill',
        output: path.paint.output,
        polylines: path.display.polylines.map((polyline) => ({
          closed: polyline.closed,
          points: polyline.points.map((point) => applyTransform(point, object.transform)),
        })),
      })),
    };
  });
}

function projectObject(
  item: Resolved,
  units: ReadonlyMap<string, string>,
  layers: Project['scene']['layers'],
  toleranceMm: number,
): SceneObjectProjection {
  const { object } = item;
  const bounds = remoteBounds(transformedBBox(object));
  if (bounds === undefined) invalidGeometry();
  const operationId = operationIdsForObject(object, layers).find(publicIdentifier);
  return {
    id: object.id,
    kind: object.kind,
    unitId: units.get(object.id) ?? object.id,
    ...(operationId === undefined ? {} : { operationId }),
    editable: object.locked !== true,
    bounds,
    paths: item.paths.map((path) => ({
      color: /^#[0-9a-f]{6}$/.test(path.color) ? path.color : FALLBACK_LAYER_COLOR,
      fill: path.fill,
      output: path.output,
      polylines: path.polylines
        .map((polyline) => ({
          closed: polyline.closed,
          points: simplify(polyline.points, toleranceMm, polyline.closed),
        }))
        .filter((polyline) => polyline.points.length >= (polyline.closed ? 3 : 2))
        .map((polyline) => ({ closed: polyline.closed, points: encodePoints(polyline.points) })),
    })),
  };
}

/** Delta-encoded hundredths of a millimetre: "x,y dx,dy ...". */
export function encodePoints(points: readonly Vec2[]): string {
  let previousX = 0;
  let previousY = 0;
  return points
    .map((point, index) => {
      const x = Math.round(point.x * 100);
      const y = Math.round(point.y * 100);
      const pair = index === 0 ? `${x},${y}` : `${x - previousX},${y - previousY}`;
      previousX = x;
      previousY = y;
      return pair;
    })
    .join(' ');
}

/** Iterative Douglas–Peucker; display only, the PC keeps the exact geometry. */
export function simplify(points: readonly Vec2[], tolerance: number, closed: boolean): Vec2[] {
  if (points.length <= 2) return [...points];
  const source = closed ? [...points, points[0] as Vec2] : points;
  const keep = new Uint8Array(source.length);
  keep[0] = 1;
  keep[source.length - 1] = 1;
  const stack: [number, number][] = [[0, source.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    let farthest = -1;
    let distance = tolerance;
    for (let index = start + 1; index < end; index += 1) {
      const d = segmentDistance(source[index] as Vec2, source[start] as Vec2, source[end] as Vec2);
      if (d > distance) {
        distance = d;
        farthest = index;
      }
    }
    if (farthest === -1) continue;
    keep[farthest] = 1;
    stack.push([start, farthest], [farthest, end]);
  }
  const result = source.filter((_, index) => keep[index] === 1);
  return closed ? result.slice(0, -1) : result;
}

function segmentDistance(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Persistent groups (including overlapping memberships) select as one unit. */
function unitIds(project: Project): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root) as string;
    parent.set(id, root);
    return root;
  };
  for (const object of project.scene.objects) parent.set(object.id, object.id);
  for (const group of project.scene.groups ?? []) {
    const [first, ...rest] = group.objectIds;
    if (first === undefined) continue;
    for (const id of rest) {
      const a = find(first);
      const b = find(id);
      if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
    }
  }
  return new Map(project.scene.objects.map((object: SceneObject) => [object.id, find(object.id)]));
}

function bedSize(project: Project) {
  const { bedWidth, bedHeight } = project.device;
  if (!(bedWidth > 0 && bedWidth <= 100_000 && bedHeight > 0 && bedHeight <= 100_000))
    invalidGeometry();
  return { widthMm: bedWidth, heightMm: bedHeight };
}
function union(extent: AABB | undefined, point: Vec2): AABB {
  return extent === undefined
    ? { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }
    : {
        minX: Math.min(extent.minX, point.x),
        minY: Math.min(extent.minY, point.y),
        maxX: Math.max(extent.maxX, point.x),
        maxY: Math.max(extent.maxY, point.y),
      };
}
const round = (value: number) => Math.round(value * 100) / 100;
