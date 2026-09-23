import {
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type Bounds,
  type ColoredPath,
  type Vec2,
} from '../../core/scene';
import { HpglError, type HpglPath, type HpglState, type ParseHpglResult } from './hpgl-types';

export function hpglResult(
  state: HpglState,
  args: { readonly id: string; readonly source: string },
): ParseHpglResult {
  const diagnostics = [...state.diagnostics.values()];
  const notes = diagnostics.map((diagnostic) => diagnostic.message);
  if (state.paths.length === 0)
    return { kind: 'ok', object: null, pathCount: 0, notes, diagnostics };
  const extent = extents(state.paths);
  const point = (p: Vec2): Vec2 => ({ x: (p.x - extent.minX) / 40, y: (extent.maxY - p.y) / 40 });
  const bounds = {
    minX: 0,
    minY: 0,
    maxX: (extent.maxX - extent.minX) / 40,
    maxY: (extent.maxY - extent.minY) / 40,
  };
  if (!Object.values(bounds).every(Number.isFinite))
    throw new HpglError(
      'invalid-geometry',
      'Artwork bounds exceed finite coordinates.',
      state.command,
    );
  // Preserve command/pen order, including repeated use of an earlier pen.
  const penColor = createPenColors();
  const paths: ColoredPath[] = state.paths.map((path) => {
    const polylines = path.polylines.map((line) => ({ ...line, points: line.points.map(point) }));
    return {
      color: penColor(path.pen),
      polylines,
      curves: polylines.map(polylineToCurveSubpath),
      ...(path.fillRule === undefined ? {} : { fillRule: path.fillRule }),
    };
  });
  return {
    kind: 'ok',
    object: {
      kind: 'imported-svg',
      id: args.id,
      source: args.source,
      bounds,
      transform: IDENTITY_TRANSFORM,
      paths,
    },
    pathCount: paths.reduce((total, path) => total + path.polylines.length, 0),
    notes,
    diagnostics,
  };
}

function extents(paths: readonly HpglPath[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const path of paths)
    for (const line of path.polylines)
      for (const point of line.points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
  return { minX, minY, maxX, maxY };
}

function createPenColors(): (pen: number) => string {
  const palette = [
    '#000000',
    '#ff0000',
    '#00aa00',
    '#0000ff',
    '#00aaaa',
    '#aa00aa',
    '#aaaa00',
    '#ff8000',
  ];
  const colors = new Map(palette.map((color, index) => [index + 1, color]));
  const reserved = new Set(palette);
  let ordinal = 0;
  return (pen) => {
    const known = colors.get(pen);
    if (known !== undefined) return known;
    let color: string;
    do {
      // Odd multiplication is a permutation modulo 2^24; the path budget is far smaller.
      ordinal += 1;
      color = `#${((ordinal * 0x9e3779) % 0x1000000).toString(16).padStart(6, '0')}`;
    } while (reserved.has(color));
    colors.set(pen, color);
    return color;
  };
}
