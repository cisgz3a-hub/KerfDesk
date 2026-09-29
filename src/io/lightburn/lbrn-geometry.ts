import {
  curveSubpathBounds,
  flattenCurveSubpath,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type PathSegment,
} from '../../core/scene';
import { parametricEllipseCurve } from '../../core/geometry';
import { multiplyMatrix, parseXFormText, transformCurve, type LbrnMatrix } from './lbrn-frame';
import { parseLbrnVertexList, type LbrnVertex } from './lbrn-vertex-list';

export type LbrnGeometryResult = {
  readonly objects: ReadonlyArray<ImportedSvg>;
  readonly unsupportedShapeTypes: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
};

type Primitive = { readonly kind: 'L' | 'B'; readonly from: number; readonly to: number };
type BuildingPath = { startIndex: number; endIndex: number; segments: PathSegment[] };
type PathTables = {
  readonly vertices: ReadonlyMap<number, ReadonlyArray<LbrnVertex>>;
  readonly primitives: ReadonlyMap<number, ReadonlyArray<Primitive>>;
};

/** `frame` places LightBurn project coordinates on the scene (lightBurnSceneFrame). */
export function importLbrnGeometry(
  root: Element,
  sourceName: string,
  frame: LbrnMatrix,
): LbrnGeometryResult {
  const objects: ImportedSvg[] = [];
  const unsupported = new Set<string>();
  const warnings: string[] = [];
  const pathTables = buildPathTables(root);
  const topShapes = [...root.children].filter((element) => normalized(element.tagName) === 'shape');
  for (const shape of topShapes)
    visitShape(shape, frame, sourceName, objects, unsupported, warnings, pathTables);
  return { objects, unsupportedShapeTypes: [...unsupported].sort(), warnings };
}

function visitShape(
  shape: Element,
  parent: LbrnMatrix,
  sourceName: string,
  objects: ImportedSvg[],
  unsupported: Set<string>,
  warnings: string[],
  pathTables: PathTables,
): void {
  const type = shape.getAttribute('Type') ?? shape.getAttribute('type') ?? '';
  if (normalized(type) === 'group') {
    const matrix = multiplyMatrix(parent, parseXForm(shape));
    const children = directChild(shape, 'children');
    for (const child of children === null ? [] : [...children.children]) {
      if (normalized(child.tagName) === 'shape')
        visitShape(child, matrix, sourceName, objects, unsupported, warnings, pathTables);
    }
    return;
  }
  if (normalized(type) === 'text') {
    const backup = [...shape.children].find((child) => normalized(child.tagName) === 'backuppath');
    if (backup === undefined) {
      unsupported.add('Text without BackupPath');
      return;
    }
    visitVectorShape(backup, parent, sourceName, shape, objects, warnings, pathTables);
    return;
  }
  if (['rect', 'ellipse', 'path'].includes(normalized(type))) {
    visitVectorShape(shape, parent, sourceName, shape, objects, warnings, pathTables);
    return;
  }
  unsupported.add(type || shape.tagName);
}

function visitVectorShape(
  shape: Element,
  parent: LbrnMatrix,
  sourceName: string,
  layerSource: Element,
  objects: ImportedSvg[],
  warnings: string[],
  pathTables: PathTables,
): void {
  const matrix = multiplyMatrix(parent, parseXForm(shape));
  const type = normalized(shape.getAttribute('Type') ?? shape.getAttribute('type') ?? 'path');
  const curves =
    type === 'rect'
      ? rectangleCurves(shape)
      : type === 'ellipse'
        ? ellipseCurves(shape)
        : pathCurves(shape, pathTables);
  if (curves.length === 0) {
    warnings.push(`${type || 'shape'} contained no supported geometry.`);
    return;
  }
  const transformed = curves.map((curve) => transformCurve(curve, matrix));
  const polylines = transformed.flatMap((curve) => {
    const flattened = flattenCurveSubpath(curve, { toleranceMm: 0.025 });
    return flattened.kind === 'ok' ? [flattened.polyline] : [];
  });
  const color = colorForCutIndex(integerAttribute(layerSource, 'CutIndex') ?? 0);
  const bounds = combinedBounds(transformed);
  objects.push({
    kind: 'imported-svg',
    id: importedObjectId(sourceName, objects.length),
    source: sourceName,
    bounds,
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines, curves: transformed }],
  });
}

function importedObjectId(sourceName: string, index: number): string {
  const source = sourceName
    .replace(/\.lbrn2?$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `lbrn-${source || 'project'}-${index + 1}`;
}

function rectangleCurves(shape: Element): CurveSubpath[] {
  const width = numberAttribute(shape, 'W');
  const height = numberAttribute(shape, 'H');
  if (width === null || height === null || width <= 0 || height <= 0) return [];
  const left = -width / 2;
  const right = width / 2;
  const top = -height / 2;
  const bottom = height / 2;
  return [
    {
      start: { x: left, y: top },
      closed: true,
      segments: [
        { kind: 'line', to: { x: right, y: top } },
        { kind: 'line', to: { x: right, y: bottom } },
        { kind: 'line', to: { x: left, y: bottom } },
        { kind: 'line', to: { x: left, y: top } },
      ],
    },
  ];
}

function ellipseCurves(shape: Element): CurveSubpath[] {
  const radiusX = numberAttribute(shape, 'Rx');
  const radiusY = numberAttribute(shape, 'Ry');
  if (radiusX === null || radiusY === null || radiusX <= 0 || radiusY <= 0) return [];
  return [
    parametricEllipseCurve({
      center: { x: 0, y: 0 },
      majorAxis: { x: radiusX, y: 0 },
      ratio: radiusY / radiusX,
      startParam: 0,
      sweep: Math.PI * 2,
      closed: true,
    }),
  ];
}

function pathCurves(shape: Element, pathTables: PathTables): CurveSubpath[] {
  const vertices = pathVertices(shape, pathTables);
  const primitives = pathPrimitives(shape, pathTables);
  const curves: CurveSubpath[] = [];
  let current: BuildingPath | null = null;
  for (const primitive of primitives) {
    const from = vertices[primitive.from];
    const to = vertices[primitive.to];
    if (from === undefined || to === undefined) continue;
    current = appendPrimitive(current, primitive, from, to, curves, vertices);
  }
  if (current !== null) curves.push(finishPath(current, vertices));
  return curves;
}

function pathVertices(shape: Element, pathTables: PathTables): ReadonlyArray<LbrnVertex> {
  const list = directChild(shape, 'vertlist');
  if (list !== null) return parseLbrnVertexList(list.textContent ?? '');
  return pathTables.vertices.get(integerAttribute(shape, 'VertID') ?? -1) ?? [];
}

function pathPrimitives(shape: Element, pathTables: PathTables): ReadonlyArray<Primitive> {
  const list = directChild(shape, 'primlist');
  if (list !== null) return parsePrimitives(list.textContent ?? '');
  return pathTables.primitives.get(integerAttribute(shape, 'PrimID') ?? -1) ?? [];
}

function buildPathTables(root: Element): PathTables {
  const vertices = new Map<number, ReadonlyArray<LbrnVertex>>();
  const primitives = new Map<number, ReadonlyArray<Primitive>>();
  for (const element of [...root.querySelectorAll('*')]) {
    const vertexId = integerAttribute(element, 'VertID');
    const vertexList = directChild(element, 'vertlist');
    if (vertexId !== null && vertexList !== null) {
      vertices.set(vertexId, parseLbrnVertexList(vertexList.textContent ?? ''));
    }
    const primitiveId = integerAttribute(element, 'PrimID');
    const primitiveList = directChild(element, 'primlist');
    if (primitiveId !== null && primitiveList !== null) {
      primitives.set(primitiveId, parsePrimitives(primitiveList.textContent ?? ''));
    }
  }
  return { vertices, primitives };
}

function appendPrimitive(
  current: BuildingPath | null,
  primitive: Primitive,
  from: LbrnVertex,
  to: LbrnVertex,
  curves: CurveSubpath[],
  vertices: ReadonlyArray<LbrnVertex>,
): BuildingPath {
  let path = current;
  if (path === null || path.endIndex !== primitive.from) {
    if (path !== null) curves.push(finishPath(path, vertices));
    path = { startIndex: primitive.from, endIndex: primitive.from, segments: [] };
  }
  path.segments.push(
    primitive.kind === 'L'
      ? { kind: 'line', to: to.point }
      : {
          kind: 'cubic',
          // `B i j` leaves V[i] along its c0 handle and arrives at V[j] along its c1.
          control1: from.outgoing ?? from.point,
          control2: to.incoming ?? to.point,
          to: to.point,
        },
  );
  path.endIndex = primitive.to;
  return path;
}

function finishPath(
  path: {
    readonly startIndex: number;
    readonly endIndex: number;
    readonly segments: PathSegment[];
  },
  vertices: ReadonlyArray<LbrnVertex>,
): CurveSubpath {
  return {
    start: (vertices[path.startIndex] as LbrnVertex).point,
    segments: path.segments,
    closed: path.startIndex === path.endIndex,
  };
}

function parsePrimitives(text: string): Primitive[] {
  return [...text.matchAll(/([LB])(\d+)\s+(\d+)/g)].map((match) => ({
    kind: match[1] as 'L' | 'B',
    from: Number(match[2]),
    to: Number(match[3]),
  }));
}

function parseXForm(shape: Element): LbrnMatrix {
  return parseXFormText(directChild(shape, 'xform')?.textContent);
}

function combinedBounds(curves: ReadonlyArray<CurveSubpath>) {
  const bounds = curves.map(curveSubpathBounds);
  return {
    minX: Math.min(...bounds.map((value) => value.minX)),
    minY: Math.min(...bounds.map((value) => value.minY)),
    maxX: Math.max(...bounds.map((value) => value.maxX)),
    maxY: Math.max(...bounds.map((value) => value.maxY)),
  };
}

function directChild(element: Element, name: string): Element | null {
  const target = normalized(name);
  return [...element.children].find((child) => normalized(child.tagName) === target) ?? null;
}
function numberAttribute(element: Element, name: string): number | null {
  const value = Number(element.getAttribute(name) ?? element.getAttribute(name.toLowerCase()));
  return Number.isFinite(value) ? value : null;
}
function integerAttribute(element: Element, name: string): number | null {
  const value = numberAttribute(element, name);
  return value === null ? null : Math.trunc(value);
}
function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const LIGHTBURN_COLORS = [
  '#000000',
  '#0000ff',
  '#ff0000',
  '#00e000',
  '#d0d000',
  '#ff8000',
  '#00e0e0',
  '#ff00ff',
];
export function colorForCutIndex(index: number): string {
  return (
    LIGHTBURN_COLORS[index] ?? `#${((index * 2654435761) & 0xffffff).toString(16).padStart(6, '0')}`
  );
}
