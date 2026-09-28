import { describe, expect, it } from 'vitest';
import { stockToStl, type StockSolid } from './stock-stl';

type Point = readonly [number, number, number];

// Reads a binary STL back: its header and each triangle's three corners.
function readStl(bytes: ArrayBuffer): { header: string; triangles: Point[][] } {
  const view = new DataView(bytes);
  const count = view.getUint32(80, true);
  expect(bytes.byteLength).toBe(84 + 50 * count);
  const triangles: Point[][] = [];
  for (let at = 0; at < count; at += 1) {
    const base = 84 + at * 50 + 12;
    const corner = (k: number): Point => [
      view.getFloat32(base + k * 12, true),
      view.getFloat32(base + k * 12 + 4, true),
      view.getFloat32(base + k * 12 + 8, true),
    ];
    triangles.push([corner(0), corner(1), corner(2)]);
  }
  return { header: new TextDecoder().decode(new Uint8Array(bytes, 0, 80)), triangles };
}

// Every edge is walked once each way by the triangles either side of it: the
// surface is closed, and every triangle faces the same way round.
function openEdges(triangles: Point[][]): number {
  const walked = new Map<string, number>();
  const key = (a: Point, b: Point): string => `${a.join(',')}>${b.join(',')}`;
  for (const [a, b, c] of triangles) {
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      if (p === undefined || q === undefined) continue;
      walked.set(key(p, q), (walked.get(key(p, q)) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [edge, count] of walked) {
    const [p, q] = edge.split('>');
    if (count !== 1 || walked.get(`${q}>${p}`) !== 1) open += 1;
  }
  return open;
}

// The volume inside, positive when every triangle faces out.
function volume(triangles: Point[][]): number {
  let sum = 0;
  for (const [a, b, c] of triangles) {
    if (a === undefined || b === undefined || c === undefined) continue;
    sum +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  return sum;
}

// 10 x 6 cells of 1 mm, 5 mm thick, with `carve` setting some cells' depth.
function stock(carve: (column: number, row: number) => number = () => 0): StockSolid {
  const depth = new Float32Array(60);
  for (let row = 0; row < 6; row += 1) {
    for (let column = 0; column < 10; column += 1) depth[row * 10 + column] = carve(column, row);
  }
  return {
    originX: 20,
    originY: 30,
    mmPerCell: 1,
    widthCells: 10,
    heightCells: 6,
    widthMm: 10,
    heightMm: 6,
    depth,
    bottomZ: -5,
  };
}

function solid(carved: StockSolid) {
  const stl = stockToStl(carved);
  if (stl === null) throw new Error('no solid');
  const read = readStl(stl.bytes);
  expect(read.triangles).toHaveLength(stl.triangles);
  return read;
}

describe('the carved stock as an STL solid (ADR-487)', () => {
  it('is the whole block, closed, when nothing is carved', () => {
    const { header, triangles } = solid(stock());
    // Readers take a header starting "solid" for a text STL.
    expect(header.startsWith('solid')).toBe(false);
    expect(header).toContain('KerfDesk');
    expect(openEdges(triangles)).toBe(0);
    expect(volume(triangles)).toBeCloseTo(10 * 6 * 5, 3);
    const xs = triangles.flat().map((point) => point[0]);
    const zs = triangles.flat().map((point) => point[2]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([20, 30]);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([-5, 0]);
    // The flat top is one strip a row, not two triangles a square.
    expect(triangles.length).toBeLessThan(60);
  });

  it('carves a pocket out of it, still closed', () => {
    const pocket = (column: number, row: number): number =>
      column >= 3 && column <= 6 && row >= 2 && row <= 3 ? -2 : 0;
    const { triangles } = solid(stock(pocket));
    expect(openEdges(triangles)).toBe(0);
    // 4 x 2 cells 2 mm deep, sloped to the next cell's centre round the edge.
    expect(volume(triangles)).toBeCloseTo(300 - 16, 0);
    expect(Math.min(...triangles.flat().map((point) => point[2]))).toBe(-5);
  });

  it('leaves a walled hole where a cut goes through', () => {
    const hole = (column: number, row: number): number =>
      column >= 4 && column <= 5 && row >= 2 && row <= 3 ? -6 : 0;
    const { triangles } = solid(stock(hole));
    expect(openEdges(triangles)).toBe(0);
    // Every square touching a cut-through cell goes: 3 x 3 squares between centres.
    expect(volume(triangles)).toBeCloseTo(300 - 3 * 3 * 5, 3);
    const top = triangles.filter((corners) => corners.every((point) => point[2] === 0));
    const covers = (x: number, y: number): boolean =>
      top.some(
        ([a, b, c]) =>
          a !== undefined && b !== undefined && c !== undefined && inside(x, y, a, b, c),
      );
    expect(covers(25, 33)).toBe(false);
    expect(covers(21, 31)).toBe(true);
  });

  it('stays closed over a surface with no two squares alike', () => {
    const rough = (column: number, row: number): number =>
      -1 - 0.5 * Math.sin(column * 1.3 + row * 0.7) - ((column * 7 + row * 3) % 5) * 0.1;
    const { triangles } = solid(stock(rough));
    expect(openEdges(triangles)).toBe(0);
    expect(volume(triangles)).toBeGreaterThan(0);
    // Two triangles a square on top; the flat bottom needs vertices only
    // along its edges, not under every square.
    const bottom = triangles.filter((corners) => corners.every((point) => point[2] === -5));
    expect(triangles.length - bottom.length).toBeGreaterThan(2 * 9 * 5);
    expect(bottom.length).toBeLessThan(40);
  });

  it('is closed where flat, sloped and cut-through squares meet', () => {
    const mixed = (column: number, row: number): number => {
      if (column === 7 && row === 3) return -9;
      if (column < 3) return -1;
      return row === 0 ? 0 : -0.3 * column;
    };
    const { triangles } = solid(stock(mixed));
    expect(openEdges(triangles)).toBe(0);
    expect(volume(triangles)).toBeGreaterThan(0);
  });

  it('has nothing to save when every cell is cut through', () => {
    expect(stockToStl(stock(() => -8))).toBeNull();
  });
});

function inside(x: number, y: number, a: Point, b: Point, c: Point): boolean {
  const side = (p: Point, q: Point): number =>
    (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
  const ab = side(a, b);
  const bc = side(b, c);
  const ca = side(c, a);
  return (ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0);
}
