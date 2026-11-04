import { describe, expect, it } from 'vitest';
import { buildMotionManifest, type MotionBlock, type MotionPoint } from './motion-manifest';
import { MotionBlockColumns, motionBlockColumnBytes } from './motion-block-columns';
import { MotionBlockColumnsBuilder, motionBlockColumnsFrom } from './motion-block-columns-builder';
import { isMotionBlockColumnData } from './motion-block-columns-validation';
import type { BuildMotionManifestOptions } from './motion-manifest';
import { buildObjectMotionManifest } from './motion-manifest-object-reference.test-support';

// ADR-244 Amendment 3: the parser writes columns instead of one object per
// block and per point. Every field must be the reference parser's to the bit.

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 2 ** 32;
  };
}

const coordinate = (random: () => number): string => {
  const pick = random();
  if (pick < 0.05) return '-0';
  if (pick < 0.1) return '0.0000000001';
  return (random() * 200 - 100).toFixed(random() < 0.5 ? 3 : 4);
};

type LineMaker = (random: () => number, line: number) => string;

/** Lines drawn from every construct the parser treats specially, by weight. */
const LINE_MAKERS: ReadonlyArray<readonly [number, LineMaker]> = [
  [30, (r, n) => `${numbered(r, n)}G1 X${coordinate(r)} S${Math.floor(r() * 1000)}`],
  [10, (r, n) => `${numbered(r, n)}G0 X${coordinate(r)} Y${coordinate(r)}`],
  [7, (r) => `G1 Y${coordinate(r)} Z${coordinate(r)}`],
  [5, (r) => `G2 X${coordinate(r)} Y${coordinate(r)} I5 J0`],
  [3, (r) => `G3 X${coordinate(r)} R7.5`],
  [5, () => 'G1 X0 Y0'], // often zero length
  [3, (r) => (r() < 0.5 ? 'M5' : 'M3 S800')],
  [2, (r) => (r() < 0.5 ? 'M0' : 'M1')],
  [3, (r) => (r() < 0.5 ? 'G91' : 'G90')],
  [2, (r) => (r() < 0.5 ? 'G20' : 'G21')],
  [2, () => 'M221 S50'],
  [3, (r) => (r() < 0.5 ? '' : '(comment) ; note')],
  [25, (r) => `G1 X${coordinate(r)} Y${coordinate(r)}`],
];
const TOTAL_WEIGHT = LINE_MAKERS.reduce((sum, [weight]) => sum + weight, 0);

function numbered(random: () => number, line: number): string {
  return random() < 0.1 ? `N${line + 10} ` : '';
}

function randomProgram(seed: number, lines: number): string {
  const random = seededRandom(seed);
  const out: string[] = ['; header', 'G21', 'G90', 'M4 S0'];
  for (let line = 0; line < lines; line += 1) {
    let pick = random() * TOTAL_WEIGHT;
    const maker = LINE_MAKERS.find(([weight]) => (pick -= weight) < 0) ?? LINE_MAKERS[0];
    out.push((maker as readonly [number, LineMaker])[1](random, line));
  }
  out.push('M5', 'G0 X0 Y0');
  const breaks = ['\n', '\r\n', '\r'];
  return out.join(breaks[seed % breaks.length]);
}

function expectSamePoint(actual: MotionPoint | null | undefined, expected: MotionPoint | null) {
  if (expected === null) return expect(actual ?? null).toBeNull();
  expect(Object.is(actual?.x, expected.x) && Object.is(actual?.y, expected.y)).toBe(true);
  expect(Object.is(actual?.z, expected.z)).toBe(true);
}

function expectSameBlock(actual: MotionBlock | undefined, expected: MotionBlock): void {
  expect(actual).toBeDefined();
  if (actual === undefined) return;
  for (const field of [
    'rawLineIndex',
    'sendableLineIndex',
    'programLineNumber',
    'kind',
    'lengthMm',
    'routeStartMm',
    'routeEndMm',
  ] as const) {
    expect(Object.is(actual[field], expected[field]), field).toBe(true);
  }
  expect(actual.points).toHaveLength(expected.points.length);
  expected.points.forEach((point, index) => expectSamePoint(actual.points[index], point));
}

function expectSameAsReference(gcode: string, options: BuildMotionManifestOptions): void {
  const reference = buildObjectMotionManifest(gcode, options);
  const columns = buildMotionManifest(gcode, options);
  expect(columns.blocks).toBeInstanceOf(MotionBlockColumns);
  expect(columns.blocks.length).toBe(reference.blocks.length);
  reference.blocks.forEach((block, index) => expectSameBlock(columns.blocks.at(index), block));
  expect(Object.is(columns.totalRouteMm, reference.totalRouteMm)).toBe(true);
  expect(columns.sendableLineCount).toBe(reference.sendableLineCount);
  expectSamePoint(columns.firstProcessPoint, reference.firstProcessPoint);
  expectSamePoint(columns.finalPoint, reference.finalPoint);
  const data = (columns.blocks as MotionBlockColumns).data;
  expect(isMotionBlockColumnData(structuredClone(data))).toBe(true);
}

describe('motion block columns', () => {
  it.each(Array.from({ length: 24 }, (_unused, seed) => seed))(
    'equal the object parser bit for bit on generated program %i',
    (seed) => {
      const gcode = randomProgram(seed, 400);
      expectSameAsReference(gcode, { machineKind: 'laser' });
      expectSameAsReference(gcode, { machineKind: 'cnc', initialPosition: { x: 1, y: 2, z: 5 } });
      expectSameAsReference(gcode, { machineKind: 'laser', laserPowerControl: 'smoothieware' });
    },
  );

  it('stores a shared start once and keeps one that differs from the last end', () => {
    // The zero-length G1 moves the head by 1e-10 without a block, so the next
    // block starts where no block ended.
    const gcode = 'G21\nG90\nM4 S100\nG1 X1\nG1 X2\nG1 X2.0000000001\nG1 X3\n';
    expectSameAsReference(gcode, { machineKind: 'laser' });
    const blocks = buildMotionManifest(gcode, { machineKind: 'laser' }).blocks;
    const data = (blocks as MotionBlockColumns).data;
    expect(data.x.length).toBe(5); // 0, 1 | 2 | 2.0000000001, 3
    expect(data.z).toBeNull();
  });

  it('keeps a Z column only once Z changes, and -0 apart from 0', () => {
    const gcode = 'G21\nG90\nM3 S100\nG1 X1 Z-0\nG1 X2 Z0\nG1 X3 Z-1\n';
    expectSameAsReference(gcode, { machineKind: 'cnc' });
    const data = (buildMotionManifest(gcode, { machineKind: 'cnc' }).blocks as MotionBlockColumns)
      .data;
    expect(data.z).not.toBeNull();
    expect(Object.is(data.z?.[1], -0)).toBe(true);
  });

  it('grows past its capacity hint without changing a block', () => {
    const blocks = Array.from(
      buildObjectMotionManifest(randomProgram(99, 300), { machineKind: 'laser' }).blocks,
    );
    const builder = new MotionBlockColumnsBuilder(1, 1);
    for (const block of blocks) builder.push(block);
    const columns = builder.finish();
    blocks.forEach((block, index) => expectSameBlock(columns.at(index), block));
    expect(Array.from(motionBlockColumnsFrom(blocks, blocks.length))).toHaveLength(blocks.length);
  });

  // The regression guard for S4-P2-2: a raster row costs bytes, not objects.
  it('holds a raster program in under 40 bytes per streamed line', () => {
    const rows: string[] = ['G21', 'G90', 'M4 S0', 'G0 X0 Y0'];
    for (let row = 0; row < 200; row += 1) {
      rows.push(`G0 Y${(row / 10).toFixed(1)}`);
      for (let step = 1; step <= 100; step += 1) {
        const x = row % 2 === 0 ? step / 10 : 10 - step / 10;
        rows.push(`G1 X${x.toFixed(1)} S${(step * 7) % 1000}`);
      }
    }
    rows.push('M5');
    const manifest = buildMotionManifest(rows.join('\n'), { machineKind: 'laser' });
    const bytes = motionBlockColumnBytes((manifest.blocks as MotionBlockColumns).data);
    expect(bytes / rows.length).toBeLessThan(40);
  });

  it.each([
    ['an unordered raw line', (data: Record<string, Uint32Array>) => (data['rawLine']![1] = 0)],
    [
      'a sendable index past its line',
      (data: Record<string, Uint32Array>) => (data['sendable']![0] = 99),
    ],
    ['an unknown kind', (data: Record<string, Uint8Array>) => (data['kind']![0] = 9)],
    ['a shared first block', (data: Record<string, Uint8Array>) => (data['kind']![0] = 0x81)],
    [
      'a route end off its length',
      (data: Record<string, Float64Array>) => (data['routeEnd']![0] = 99),
    ],
    ['a non-finite point', (data: Record<string, Float64Array>) => (data['x']![0] = Infinity)],
  ] as const)('reject %s', (_name, corrupt) => {
    const manifest = buildMotionManifest('G21\nG90\nM4 S100\nG1 X1\nG1 X2 Y1\nG1 X5\n', {
      machineKind: 'laser',
    });
    const data = structuredClone((manifest.blocks as MotionBlockColumns).data);
    expect(isMotionBlockColumnData(data)).toBe(true);
    corrupt(data as unknown as Record<string, never>);
    expect(isMotionBlockColumnData(data)).toBe(false);
  });
});
