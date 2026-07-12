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

export type LbrnGeometryResult = {
  readonly objects: ReadonlyArray<ImportedSvg>;
  readonly unsupportedShapeTypes: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
};

type Matrix = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};
type ParsedVertex = { readonly point: Vec2; readonly left?: Vec2; readonly right?: Vec2 };
type Primitive = { readonly kind: 'L' | 'B'; readonly from: number; readonly to: number };
type BuildingPath = { startIndex: number; endIndex: number; segments: PathSegment[] };
type PathTables = {
  readonly vertices: ReadonlyMap<number, ReadonlyArray<ParsedVertex>>;
  readonly primitives: ReadonlyMap<number, ReadonlyArray<Primitive>>;
};
const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function importLbrnGeometry(root: Element, sourceName: string): LbrnGeometryResult {
  const objects: ImportedSvg[] = [];
  const unsupported = new Set<string>();
  const warnings: string[] = [];
  const pathTables = buildPathTables(root);
  const topShapes = [...root.children].filter((element) => normalized(element.tagName) === 'shape');
  for (const shape of topShapes)
    visitShape(shape, IDENTITY, sourceName, objects, unsupported, warnings, pathTables);
  return { objects, unsupportedShapeTypes: [...unsupported].sort(), warnings };
}

function visitShape(
  shape: Element,
  parent: Matrix,
  sourceName: string,
  objects: ImportedSvg[],
  unsupported: Set<string>,
  warnings: string[],
  pathTables: PathTables,
): void {
  const type = shape.getAttribute('Type') ?? shape.getAttribute('type') ?? '';
  if (normalized(type) === 'group') {
    const matrix = multiply(parent, parseXForm(shape));
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
  parent: Matrix,
  sourceName: string,
  layerSource: Element,
  objects: ImportedSvg[],
  warnings: string[],
  pathTables: PathTables,
): void {
  const matrix = multiply(parent, parseXForm(shape));
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

function pathVertices(shape: Element, pathTables: PathTables): ReadonlyArray<ParsedVertex> {
  const list = directChild(shape, 'vertlist');
  if (list !== null) return parseVertices(list.textContent ?? '');
  return pathTables.vertices.get(integerAttribute(shape, 'VertID') ?? -1) ?? [];
}

function pathPrimitives(shape: Element, pathTables: PathTables): ReadonlyArray<Primitive> {
  const list = directChild(shape, 'primlist');
  if (list !== null) return parsePrimitives(list.textContent ?? '');
  return pathTables.primitives.get(integerAttribute(shape, 'PrimID') ?? -1) ?? [];
}

function buildPathTables(root: Element): PathTables {
  const vertices = new Map<number, ReadonlyArray<ParsedVertex>>();
  const primitives = new Map<number, ReadonlyArray<Primitive>>();
  for (const element of [...root.querySelectorAll('*')]) {
    const vertexId = integerAttribute(element, 'VertID');
    const vertexList = directChild(element, 'vertlist');
    if (vertexId !== null && vertexList !== null) {
      vertices.set(vertexId, parseVertices(vertexList.textContent ?? ''));
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
  from: ParsedVertex,
  to: ParsedVertex,
  curves: CurveSubpath[],
  vertices: ReadonlyArray<ParsedVertex>,
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
          control1: from.right ?? from.point,
          control2: to.left ?? to.point,
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
  vertices: ReadonlyArray<ParsedVertex>,
): CurveSubpath {
  return {
    start: (vertices[path.startIndex] as ParsedVertex).point,
    segments: path.segments,
    closed: path.startIndex === path.endIndex,
  };
}

function parseVertices(text: string): ParsedVertex[] {
  const vertices: ParsedVertex[] = [];
  const pattern = /V(-?(?:\d+\.?\d*|\.\d+))\s+(-?(?:\d+\.?\d*|\.\d+))([\s\S]*?)(?=V|$)/g;
  for (const match of text.matchAll(pattern)) {
    const point = { x: Number(match[1]), y: Number(match[2]) };
    const controls = match[3] ?? '';
    const left = controlPoint(controls, 'c0');
    const right = controlPoint(controls, 'c1');
    vertices.push({
      point,
      ...(left === null ? {} : { left }),
      ...(right === null ? {} : { right }),
    });
  }
  return vertices;
}

function controlPoint(text: string, prefix: 'c0' | 'c1'): Vec2 | null {
  const x = new RegExp(`${prefix}x(-?(?:\\d+\\.?\\d*|\\.\\d+))`).exec(text)?.[1];
  const y = new RegExp(`${prefix}y(-?(?:\\d+\\.?\\d*|\\.\\d+))`).exec(text)?.[1];
  return x === undefined || y === undefined ? null : { x: Number(x), y: Number(y) };
}

function parsePrimitives(text: string): Primitive[] {
  return [...text.matchAll(/([LB])(\d+)\s+(\d+)/g)].map((match) => ({
    kind: match[1] as 'L' | 'B',
    from: Number(match[2]),
    to: Number(match[3]),
  }));
}

function parseXForm(shape: Element): Matrix {
  const values = (directChild(shape, 'xform')?.textContent ?? '').trim().split(/\s+/).map(Number);
  return values.length === 6 && values.every(Number.isFinite)
    ? {
        a: values[0] as number,
        b: values[1] as number,
        c: values[2] as number,
        d: values[3] as number,
        e: values[4] as number,
        f: values[5] as number,
      }
    : IDENTITY;
}

function multiply(left: Matrix, right: Matrix): Matrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function transformCurve(curve: CurveSubpath, matrix: Matrix): CurveSubpath {
  const point = (value: Vec2): Vec2 => ({
    x: matrix.a * value.x + matrix.c * value.y + matrix.e,
    y: matrix.b * value.x + matrix.d * value.y + matrix.f,
  });
  return {
    ...curve,
    start: point(curve.start),
    segments: curve.segments.map((segment) =>
      segment.kind === 'line'
        ? { ...segment, to: point(segment.to) }
        : segment.kind === 'cubic'
          ? {
              ...segment,
              control1: point(segment.control1),
              control2: point(segment.control2),
              to: point(segment.to),
            }
          : { ...segment, to: point(segment.to) },
    ),
  };
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
