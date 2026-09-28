// An image scanned at an angle (ADR-492): rows run along the scan angle on
// the bed, every consumer (G-code, preview toolpath, Frame bounds, job
// placement, the first-burn marker) places them the same way, and an image
// scanned along X writes exactly the G-code it always did.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { selectOutputStrategy } from '../output';
import { createLayer, IDENTITY_TRANSFORM, type RasterImage } from '../scene';
import { compileJob } from './compile-job';
import { firstToolpathProcessPoint } from './first-process-point';
import type { Job, RasterGroup } from './job';
import { computeJobBounds, computeJobMotionBounds, type JobBounds } from './job-bounds';
import { applyJobOriginOffset } from './job-origin';
import { buildToolpath } from './toolpath';

type Vec = { readonly x: number; readonly y: number };
type Segment = { readonly from: Vec; readonly to: Vec };

const dev = DEFAULT_DEVICE_PROFILE;
const ORIGINS: ReadonlyArray<DeviceProfile['origin']> = [
  'front-left',
  'rear-left',
  'front-right',
  'rear-right',
];
const COORD_TOL = 0.002;

function image(width: number, height: number, luma: ReadonlyArray<number>): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: width,
    pixelHeight: height,
    bounds: { minX: 0, minY: 0, maxX: width, maxY: height },
    transform: { ...IDENTITY_TRANSFORM, x: 50, y: 50 },
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
    lumaBase64: Buffer.from(Uint8Array.from(luma)).toString('base64'),
  };
}

const solid = (width: number, height: number): RasterImage =>
  image(width, height, new Array<number>(width * height).fill(0));

// Left column black, right column white.
const leftColumn = (): RasterImage => image(2, 2, [0, 255, 0, 255]);

function imageLayer(overrides: Partial<ReturnType<typeof createLayer>> = {}) {
  return {
    ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
    ditherAlgorithm: 'threshold' as const,
    linesPerMm: 1,
    ...overrides,
  };
}

function compile(
  obj: RasterImage,
  overrides: Partial<ReturnType<typeof createLayer>> = {},
  device: DeviceProfile = dev,
): Job {
  return compileJob({ objects: [obj], layers: [imageLayer(overrides)] }, device);
}

function emit(job: Job, device: DeviceProfile = dev): string {
  return selectOutputStrategy(device).emit(job, device);
}

function rasterGroups(job: Job): RasterGroup[] {
  return job.groups.filter((group): group is RasterGroup => group.kind === 'raster');
}

type ModalState = { pos: Vec; motion: string; s: number; laserOn: boolean };

function wordValue(line: string, letter: string): number | undefined {
  const match = new RegExp(`${letter}(-?[\\d.]+)`).exec(line);
  return match === null ? undefined : Number(match[1]);
}

// Updates the modal state for one line; returns the move's target, if any.
function applyLine(state: ModalState, line: string): Vec | null {
  if (/M[34]/.test(line)) state.laserOn = true;
  if (/M5/.test(line)) state.laserOn = false;
  const g = /G([01])(?!\d)/.exec(line);
  if (g !== null) state.motion = `G${g[1]}`;
  state.s = wordValue(line, 'S') ?? state.s;
  const x = wordValue(line, 'X');
  const y = wordValue(line, 'Y');
  if (x === undefined && y === undefined) return null;
  return { x: x ?? state.pos.x, y: y ?? state.pos.y };
}

// Burning G1 moves and every commanded point, from modal GRBL G-code.
function parseMotion(gcode: string): { burns: Segment[]; points: Vec[] } {
  const burns: Segment[] = [];
  const points: Vec[] = [];
  const state: ModalState = { pos: { x: 0, y: 0 }, motion: '', s: 0, laserOn: false };
  for (const raw of gcode.split('\n')) {
    const next = applyLine(state, raw.split(';')[0]?.replace(/\s+/g, '') ?? '');
    if (next === null) continue;
    if (state.motion === 'G1' && state.laserOn && state.s > 0) {
      burns.push({ from: state.pos, to: next });
    }
    points.push(next);
    state.pos = next;
  }
  return { burns, points };
}

function expectInside(p: Vec, bounds: JobBounds, tol: number): void {
  expect(p.x).toBeGreaterThanOrEqual(bounds.minX - tol);
  expect(p.x).toBeLessThanOrEqual(bounds.maxX + tol);
  expect(p.y).toBeGreaterThanOrEqual(bounds.minY - tol);
  expect(p.y).toBeLessThanOrEqual(bounds.maxY + tol);
}

const length = (seg: Segment): number => Math.hypot(seg.to.x - seg.from.x, seg.to.y - seg.from.y);

describe('image scan angle (ADR-492)', () => {
  it.each(ORIGINS)('writes the historical G-code along X at 0 and 180 degrees (%s)', (origin) => {
    const device = { ...dev, origin };
    const obj = image(3, 2, [0, 128, 255, 40, 0, 200]);
    const reference = emit(compile(obj, {}, device), device);
    for (const imageScanAngleDeg of [0, 180, -180]) {
      const job = compile(obj, { imageScanAngleDeg }, device);
      expect(rasterGroups(job)[0]?.scanAngleDeg).toBeUndefined();
      expect(emit(job, device)).toBe(reference);
    }
  });

  it.each(ORIGINS)('burns the same column along Y at 90 degrees as along X (%s)', (origin) => {
    const device = { ...dev, origin };
    const alongX = parseMotion(emit(compile(leftColumn(), {}, device), device)).burns;
    const alongY = parseMotion(
      emit(compile(leftColumn(), { imageScanAngleDeg: 90 }, device), device),
    ).burns;
    expect(alongX.length).toBeGreaterThan(0);
    expect(alongY.length).toBeGreaterThan(0);
    for (const seg of alongX) expect(seg.to.y).toBeCloseTo(seg.from.y, 6);
    for (const seg of alongY) expect(seg.to.x).toBeCloseTo(seg.from.x, 6);
    const xs = alongX.flatMap((seg) => [seg.from.x, seg.to.x]);
    for (const seg of alongY) {
      expect(seg.from.x).toBeGreaterThan(Math.min(...xs));
      expect(seg.from.x).toBeLessThan(Math.max(...xs));
    }
    const burnedX = alongX.reduce((sum, seg) => sum + length(seg), 0);
    const burnedY = alongY.reduce((sum, seg) => sum + length(seg), 0);
    expect(burnedY).toBeCloseTo(burnedX, 6);
  });

  it.each(ORIGINS)('keeps 45-degree rows inside the image and fills it (%s)', (origin) => {
    const device = { ...dev, origin };
    const obj = solid(10, 4);
    const footprint = computeJobBounds(compile(obj, {}, device), device);
    if (footprint === null) throw new Error('expected bounds');
    const linesPerMm = 5;
    for (const powerMode of ['dynamic', 'constant'] as const) {
      const job = compile(obj, { imageScanAngleDeg: 45, linesPerMm, powerMode }, device);
      expect(rasterGroups(job)[0]?.scanAngleDeg).toBe(45);
      const { burns } = parseMotion(emit(job, device));
      // A burn pixel reaches half a scan pixel diagonal past the artwork.
      const tol = Math.SQRT1_2 / linesPerMm + COORD_TOL;
      for (const seg of burns) {
        expectInside(seg.from, footprint, tol);
        expectInside(seg.to, footprint, tol);
        expect(Math.abs(seg.to.x - seg.from.x)).toBeCloseTo(Math.abs(seg.to.y - seg.from.y), 2);
      }
      const burned = burns.reduce((sum, seg) => sum + length(seg), 0);
      // Area over row spacing: 40 mm² at 0.2 mm rows.
      expect(burned / ((10 * 4) / (1 / linesPerMm))).toBeGreaterThan(0.95);
      expect(burned / ((10 * 4) / (1 / linesPerMm))).toBeLessThan(1.05);
    }
  });

  it('bounds every angled move for Frame, overscan runways included', () => {
    for (const imageScanAngleDeg of [30, 90, 135]) {
      const job = compile(solid(10, 4), { imageScanAngleDeg, imageBidirectional: true });
      const motion = computeJobMotionBounds(job, dev);
      if (motion === null) throw new Error('expected motion bounds');
      const { points } = parseMotion(emit(job));
      // The last point is the return to the machine origin, not job motion.
      for (const p of points.slice(0, -1)) expectInside(p, motion, COORD_TOL);
      const burnBounds = computeJobBounds(job, dev);
      if (burnBounds === null) throw new Error('expected burn bounds');
      // The runways run along the scan, so at 90 degrees they widen only Y.
      const span = (b: JobBounds): number => b.maxX - b.minX + (b.maxY - b.minY);
      expect(span(motion)).toBeGreaterThan(span(burnBounds) + 5);
    }
  });

  it('draws the preview toolpath on the burns the G-code writes', () => {
    const job = compile(solid(6, 3), { imageScanAngleDeg: 60, linesPerMm: 2 });
    const burns = parseMotion(emit(job)).burns;
    const cuts = buildToolpath(job).steps.flatMap((step) =>
      step.kind === 'cut' && step.polyline.length === 2 ? [step.polyline] : [],
    );
    expect(cuts).toHaveLength(burns.length);
    cuts.forEach(([from, to], index) => {
      const burn = burns[index];
      if (from === undefined || to === undefined || burn === undefined) throw new Error('burn');
      expect(Math.abs(from.x - burn.from.x)).toBeLessThan(COORD_TOL);
      expect(Math.abs(from.y - burn.from.y)).toBeLessThan(COORD_TOL);
      expect(Math.abs(to.x - burn.to.x)).toBeLessThan(COORD_TOL);
      expect(Math.abs(to.y - burn.to.y)).toBeLessThan(COORD_TOL);
    });
    const first = firstToolpathProcessPoint(job);
    const firstBurn = burns[0]?.from;
    if (first === null || firstBurn === undefined) throw new Error('expected a first burn');
    expect(Math.abs(first.x - firstBurn.x)).toBeLessThan(COORD_TOL);
    expect(Math.abs(first.y - firstBurn.y)).toBeLessThan(COORD_TOL);
  });

  it('moves an angled scan by the placement offset on the bed', () => {
    const job = compile(solid(6, 3), { imageScanAngleDeg: 30, linesPerMm: 2 });
    const before = parseMotion(emit(job)).burns;
    const after = parseMotion(emit(applyJobOriginOffset(job, { x: 7, y: -4 }))).burns;
    expect(after).toHaveLength(before.length);
    after.forEach((seg, index) => {
      const ref = before[index];
      if (ref === undefined) throw new Error('burn');
      expect(Math.abs(seg.from.x - (ref.from.x + 7))).toBeLessThan(COORD_TOL);
      expect(Math.abs(seg.from.y - (ref.from.y - 4))).toBeLessThan(COORD_TOL);
    });
  });

  // Hatch and scan angles turn counter-clockwise in machine coordinates. An
  // origin that flips one axis mirrors the scene into the machine, so there an
  // image lines up with a 30-degree scan when it is turned -30 degrees.
  it.each([
    ['front-left', -30],
    ['rear-left', 30],
    ['front-right', 30],
    ['rear-right', -30],
  ] as const)(
    'passes an image turned with the scan straight through its own cells (%s)',
    (origin, rotationDeg) => {
      const device = { ...dev, origin };
      const pattern = [0, 255, 255, 0, 0, 0];
      const obj = {
        ...image(2, 3, pattern),
        transform: { ...IDENTITY_TRANSFORM, x: 50, y: 50, rotationDeg },
      };
      const job = compile(obj, { imageScanAngleDeg: 30, passThrough: true }, device);
      const group = rasterGroups(job)[0];
      expect(group).toMatchObject({ scanAngleDeg: 30, pixelWidth: 2, pixelHeight: 3 });
      const burned = Array.from(group?.sValues ?? []).filter((value) => value > 0);
      expect(burned).toHaveLength(pattern.filter((luma) => luma === 0).length);
    },
  );

  it('swaps the pass-through grid when the scan turns a quarter from the image', () => {
    const obj = image(2, 3, [0, 0, 0, 0, 0, 0]);
    const job = compile(obj, { imageScanAngleDeg: 90, passThrough: true });
    expect(rasterGroups(job)[0]).toMatchObject({ pixelWidth: 3, pixelHeight: 2 });
  });

  it('adds a crossing group at +90 degrees for every pass with cross-hatch', () => {
    const job = compile(solid(4, 4), { passes: 2, imageScanAngleDeg: 30, imageCrossHatch: true });
    expect(rasterGroups(job).map((g) => [g.scanAngleDeg, g.passes])).toEqual([
      [30, 1],
      [120, 1],
      [30, 1],
      [120, 1],
    ]);
  });

  it('turns each pass by the angle change per pass, merging repeats', () => {
    const job = compile(solid(4, 4), { passes: 3, passAngleStepDeg: 45 });
    expect(rasterGroups(job).map((g) => [g.scanAngleDeg, g.passes])).toEqual([
      [undefined, 1],
      [45, 1],
      [90, 1],
    ]);
    const steady = compile(solid(4, 4), { passes: 3, imageScanAngleDeg: 20 });
    expect(rasterGroups(steady).map((g) => [g.scanAngleDeg, g.passes])).toEqual([[20, 3]]);
  });

  it('scans along X on a rotary and says the angles were set aside', () => {
    const rotary = {
      ...dev,
      rotary: {
        enabled: true,
        type: 'chuck' as const,
        mmPerRotation: 360,
        objectDiameterMm: 60,
      },
    };
    const job = compile(solid(4, 4), { passes: 2, imageCrossHatch: true }, rotary);
    expect(rasterGroups(job).map((g) => [g.scanAngleDeg, g.passes])).toEqual([[undefined, 2]]);
    expect(job.diagnostics).toContainEqual({
      kind: 'image-scan-angle-rotary',
      layerName: imageLayer().name,
      source: 'photo.png',
    });
    const plain = compile(solid(4, 4), { passes: 2 }, rotary);
    expect(plain.diagnostics?.some((d) => d.kind === 'image-scan-angle-rotary') ?? false).toBe(
      false,
    );
  });
});
