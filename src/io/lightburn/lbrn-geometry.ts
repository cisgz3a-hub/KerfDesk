import {
  curveSubpathBounds,
  flattenCurveSubpath,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type PathSegment,
  type Vec2,
} from '../../core/scene';
import { parametricEllipseCurve } from '../../core/geometry';
import { rectangleToCurve } from '../../core/shapes/primitives';
import { multiplyMatrix, parseXFormText, transformCurve, type LbrnMatrix } from './lbrn-frame';
import { parseLbrnVertexList, type LbrnVertex } from './lbrn-vertex-list';

export type LbrnGeometryResult = {
  readonly objects: ReadonlyArray<ImportedSvg>;
  readonly unsupportedShapeTypes: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
};

type Primitive = { readonly kind: 'L' | 'B'; readonly from: number; readonly to: number };
/** A PrimList: its primitives, or LightBurn's `LineClosed` / `LineOpen`, which
 * join every vertex in order with lines (ADR-388). */
type PrimitiveList = ReadonlyArray<Primitive> | { readonly joinAll: 'closed' | 'open' };
type BuildingPath = { startIndex: number; endIndex: number; segments: PathSegment[] };
type PathTables = {
  readonly vertices: ReadonlyMap<number, ReadonlyArray<LbrnVertex>>;
  readonly primitives: ReadonlyMap<number, PrimitiveList>;
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
  // A Rect is centred on its origin. `Cr` is its corner radius: each corner a
  // quarter circle, as KerfDesk's own Rectangle draws it (ADR-388).
  const cornerRadiusMm = numberAttribute(shape, 'Cr') ?? 0;
  const outline = rectangleToCurve({ widthMm: width, heightMm: height, cornerRadiusMm });
  return [transformCurve(outline, { a: 1, b: 0, c: 0, d: 1, e: -width / 2, f: -height / 2 })];
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
  const primitives = expandedPrimitives(pathPrimitives(shape, pathTables), vertices.length);
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

// A legacy .lbrn path writes each vertex as <V vx vy c0x c0y c1x c1y/> and
// each primitive as <P T="L|B" p0 p1/>, with the handles meaning what they do
// in a LightBurn 2 VertList (ADR-388).
function pathVertices(shape: Element, pathTables: PathTables): ReadonlyArray<LbrnVertex> {
  const list = directChild(shape, 'vertlist');
  if (list !== null) return parseLbrnVertexList(list.textContent ?? '');
  const legacy = childrenNamed(shape, 'v');
  if (legacy.length > 0) return legacy.map(legacyVertex);
  return pathTables.vertices.get(integerAttribute(shape, 'VertID') ?? -1) ?? [];
}

function pathPrimitives(shape: Element, pathTables: PathTables): PrimitiveList {
  const list = directChild(shape, 'primlist');
  if (list !== null) return parsePrimitives(list.textContent ?? '');
  const legacy = childrenNamed(shape, 'p');
  if (legacy.length > 0) return legacy.flatMap(legacyPrimitive);
  return pathTables.primitives.get(integerAttribute(shape, 'PrimID') ?? -1) ?? [];
}

function legacyVertex(element: Element): LbrnVertex {
  const outgoing = legacyHandle(element, 'c0');
  const incoming = legacyHandle(element, 'c1');
  return {
    point: { x: numberAttribute(element, 'vx') ?? 0, y: numberAttribute(element, 'vy') ?? 0 },
    ...(outgoing === null ? {} : { outgoing }),
    ...(incoming === null ? {} : { incoming }),
  };
}

function legacyHandle(element: Element, handle: 'c0' | 'c1'): Vec2 | null {
  const x = numberAttribute(element, `${handle}x`);
  const y = numberAttribute(element, `${handle}y`);
  return x === null && y === null ? null : { x: x ?? 0, y: y ?? 0 };
}

function legacyPrimitive(element: Element): Primitive[] {
  const kind = (element.getAttribute('T') ?? '').toUpperCase();
  const from = integerAttribute(element, 'p0');
  const to = integerAttribute(element, 'p1');
  if ((kind !== 'L' && kind !== 'B') || from === null || to === null) return [];
  return [{ kind, from, to }];
}

function buildPathTables(root: Element): PathTables {
  const vertices = new Map<number, ReadonlyArray<LbrnVertex>>();
  const primitives = new Map<number, PrimitiveList>();
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

function parsePrimitives(text: string): PrimitiveList {
  const joinAll = /^\s*Line(Closed|Open)\s*$/i.exec(text)?.[1]?.toLowerCase();
  if (joinAll === 'closed' || joinAll === 'open') return { joinAll };
  return [...text.matchAll(/([LB])(\d+)\s+(\d+)/g)].map((match) => ({
    kind: match[1] as 'L' | 'B',
    from: Number(match[2]),
    to: Number(match[3]),
  }));
}

function expandedPrimitives(list: PrimitiveList, vertexCount: number): ReadonlyArray<Primitive> {
  if (!('joinAll' in list)) return list;
  const lines: Primitive[] = [];
  for (let index = 1; index < vertexCount; index += 1) {
    lines.push({ kind: 'L', from: index - 1, to: index });
  }
  if (list.joinAll === 'closed' && vertexCount > 2) {
    lines.push({ kind: 'L', from: vertexCount - 1, to: 0 });
  }
  return lines;
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
  return childrenNamed(element, name)[0] ?? null;
}
function childrenNamed(element: Element, name: string): Element[] {
  const target = normalized(name);
  return [...element.children].filter((child) => normalized(child.tagName) === target);
}
/** Null when the attribute is missing or blank, never a silent 0. */
function numberAttribute(element: Element, name: string): number | null {
  const text = element.getAttribute(name) ?? element.getAttribute(name.toLowerCase());
  if (text === null || text.trim() === '') return null;
  const value = Number(text);
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
