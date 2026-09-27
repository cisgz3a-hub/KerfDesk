// ADR-427 through the real compiler and the removal simulator the 3D preview
// uses. Stamping the relief roughing passes one at a time, in cutting order,
// shows which side of its travel each ring's NEW stock lies on. With an M3
// spindle, Climb keeps that stock on the right (ADR-251), and so does a layer
// that leaves the direction unset; Conventional keeps it on the left. A
// mirrored machine frame must not change the physical side.
//
// Before ADR-427 the rings ran outside in with the pocket winding, so every
// ring inside the boundary met its stock on its inner side and cut
// conventional under Climb, while each island ring was oriented alone and
// never mirrored.

import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords, type DeviceProfile } from '../devices';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
import { partialCellCenter } from '../grid';
import { buildToolpath, type CncContourPass, type CncGroup, type Job } from '../job';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncCutDirection,
  type CncLayerSettings,
  type ReliefObject,
  type Scene,
  type Vec2,
} from '../scene';
import { computeRemovalGrid, kernelForTool, type RemovalGrid } from '../sim';
import { compileCncJob } from './compile-cnc-job';
import { machineFrameHandedness } from './machine-frame-handedness';

const FIELD_MM = 24;
const DEPTH_MM = 3;
const CELL_MM = 0.1;
// Stock a ring removes on its other side as well, beyond this share, makes it
// a slot: its direction decides only which wall gets the climb side.
const SLOT_MINORITY = 0.2;
// Rings that remove less than this are slivers; the plunge alone is ~4 mm³.
const MIN_RING_VOLUME_MM3 = 5;

const CUTTER = DEFAULT_CNC_MACHINE_CONFIG.tools.find((tool) => tool.id === 'em-3175');

// A 24 mm field carved 3 mm deep around an 8 mm plateau left at the stock
// top, so every level holds rings around the field and around the island.
function plateauRelief(): ReliefObject {
  const samples: number[] = [];
  for (let y = 0; y < FIELD_MM; y += 1) {
    for (let x = 0; x < FIELD_MM; x += 1) {
      samples.push(x >= 8 && x < 16 && y >= 8 && y < 16 ? 255 : 0);
    }
  }
  return {
    kind: 'relief',
    id: 'plateau',
    source: 'plateau.png',
    reliefSource: testReliefHeightfield({
      width: FIELD_MM,
      height: FIELD_MM,
      physicalWidthMm: FIELD_MM,
      physicalHeightMm: FIELD_MM,
      maxDepthMm: DEPTH_MM,
      samplesU8: samples,
    }),
    targetWidthMm: FIELD_MM,
    reliefDepthMm: DEPTH_MM,
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: FIELD_MM, maxY: FIELD_MM },
    transform: IDENTITY_TRANSFORM,
  };
}

function reliefRoughing(direction: CncCutDirection | undefined, device: DeviceProfile): Job {
  const { cutDirection: _unset, ...settings }: CncLayerSettings = {
    ...DEFAULT_CNC_LAYER_SETTINGS,
    toolId: 'em-3175',
    depthPerPassMm: 1.5,
    stepoverPercent: 40,
    finishAllowanceMm: 0,
  };
  const scene: Scene = {
    objects: [plateauRelief()],
    layers: [
      {
        ...createLayer({ id: 'L1', color: '#a0522d' }),
        cnc: direction === undefined ? settings : { ...settings, cutDirection: direction },
      },
    ],
  };
  return compileCncJob(scene, device, { ...DEFAULT_CNC_MACHINE_CONFIG, toolId: 'em-3175' });
}

function roughingGroup(job: Job): Extract<CncGroup, { kind: 'cnc' }> {
  const group = job.groups.find(
    (candidate): candidate is Extract<CncGroup, { kind: 'cnc' }> =>
      candidate.kind === 'cnc' && candidate.cutType === 'relief-rough',
  );
  if (group === undefined) throw new Error('no relief roughing group');
  return group;
}

type RingStock = {
  readonly pass: CncContourPass;
  // Physical winding, as seen from above the bed.
  readonly clockwise: boolean;
  // Volume of stock this ring removes that no earlier pass removed.
  readonly leftMm3: number;
  readonly rightMm3: number;
};

// Each ring stamped alone and compared with everything cut before it.
function newStockByRing(job: Job, device: DeviceProfile): ReadonlyArray<RingStock> {
  if (CUTTER === undefined) throw new Error('missing starter end mill');
  const group = roughingGroup(job);
  const margin = CUTTER.diameterMm / 2 + 2 * CELL_MM;
  const corners = [
    toMachineCoords({ x: 0, y: 0 }, device),
    toMachineCoords({ x: FIELD_MM, y: FIELD_MM }, device),
  ];
  const minX = Math.min(...corners.map((corner) => corner.x)) - margin;
  const minY = Math.min(...corners.map((corner) => corner.y)) - margin;
  const spec = {
    originX: minX,
    originY: minY,
    widthMm: FIELD_MM + 2 * margin,
    heightMm: FIELD_MM + 2 * margin,
    mmPerCell: CELL_MM,
  };
  const kernel = kernelForTool(CUTTER, CELL_MM);
  const physicalSign = machineFrameHandedness(device.origin);
  let before: Float32Array | null = null;
  const rings: RingStock[] = [];
  for (const { pass, ring } of cuttingPieces(group)) {
    const alone = computeRemovalGrid(
      buildToolpath({ ...job, groups: [{ ...group, passes: [pass] }] }),
      spec,
      kernel,
    );
    if (alone.kind === 'error') throw new Error(alone.reason);
    before ??= new Float32Array(alone.grid.depth.length);
    if (!ring) {
      for (let i = 0; i < before.length; i += 1) {
        before[i] = Math.min(before[i] ?? 0, alone.grid.depth[i] ?? 0);
      }
      continue;
    }
    const counterClockwise = signedAreaMm2(pass.polyline) * physicalSign > 0;
    const sides = stockSides(alone.grid, before, pass, counterClockwise);
    rings.push({ pass, clockwise: !counterClockwise, ...sides });
  }
  return rings;
}

// The compiler may join closed loops with cutting links (ADR-424). Split at
// exact revisits, retaining every link in its original place so its removed
// stock contributes to the next loop's before-grid. Never treat an entire
// linked chain as one polygon: opposite island windings cancel its area.
function cuttingPieces(group: CncGroup): ReadonlyArray<{ pass: CncContourPass; ring: boolean }> {
  const pieces: { pass: CncContourPass; ring: boolean }[] = [];
  for (const pass of group.passes) {
    if (pass.kind !== 'contour') throw new Error('expected non-ramped fixture');
    let pending = 0;
    let seen = new Map<string, number>();
    const append = (points: ReadonlyArray<Vec2>, ring: boolean): void => {
      if (points.length > 1)
        pieces.push({ pass: { ...pass, polyline: points, closed: false }, ring });
    };
    for (let index = 0; index < pass.polyline.length; index += 1) {
      const point = pass.polyline[index];
      if (point === undefined) throw new Error('missing point');
      const key = `${point.x},${point.y}`;
      const start = seen.get(key);
      if (start !== undefined && index - start >= 3) {
        append(pass.polyline.slice(pending, start + 1), false);
        append(pass.polyline.slice(start, index + 1), true);
        pending = index;
        seen = new Map([[key, index]]);
      } else seen.set(key, index);
    }
    append(pass.polyline.slice(pending), false);
    const edges = (points: ReadonlyArray<Vec2>): unknown[] =>
      points.slice(1).map((point, index) => [points[index], point]);
    const recovered = pieces.filter(({ pass: part }) => part.zMm === pass.zMm);
    // Each source chain is itself represented exactly; the assertion below
    // also guards accidental omission of a cutting link by this test oracle.
    const count = pass.polyline.length - 1;
    expect(recovered.flatMap(({ pass: part }) => edges(part.polyline)).slice(-count)).toEqual(
      edges(pass.polyline),
    );
  }
  return pieces;
}

// A ring's interior lies on its left when it runs counter-clockwise. Cells the
// ring cuts deeper than before are split by an even-odd scan of its polygon.
function stockSides(
  grid: RemovalGrid,
  before: Float32Array,
  pass: CncContourPass,
  counterClockwise: boolean,
): { readonly leftMm3: number; readonly rightMm3: number } {
  let leftMm3 = 0;
  let rightMm3 = 0;
  for (let row = 0; row < grid.heightCells; row += 1) {
    const y = grid.originY + partialCellCenter(grid, 'y', row);
    const crossings = rowCrossings(pass, y);
    let crossed = 0;
    for (let col = 0; col < grid.widthCells; col += 1) {
      const x = grid.originX + partialCellCenter(grid, 'x', col);
      while (crossed < crossings.length && (crossings[crossed] ?? Infinity) < x) crossed += 1;
      const index = row * grid.widthCells + col;
      const was = before[index] ?? 0;
      const now = grid.depth[index] ?? 0;
      if (!(now < was)) continue;
      const volume = (was - now) * CELL_MM * CELL_MM;
      const inside = crossed % 2 === 1;
      if (inside === counterClockwise) leftMm3 += volume;
      else rightMm3 += volume;
      before[index] = now;
    }
  }
  return { leftMm3, rightMm3 };
}

function rowCrossings(pass: CncContourPass, y: number): ReadonlyArray<number> {
  const points = pass.polyline;
  const crossings: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    const aBelow = a.y <= y;
    const bBelow = b.y <= y;
    if (aBelow === bBelow) continue;
    crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
  }
  return crossings.sort((p, q) => p - q);
}

function requestedShare(ring: RingStock, direction: CncCutDirection | undefined): number {
  const requested = direction === 'conventional' ? ring.leftMm3 : ring.rightMm3;
  return requested / (ring.leftMm3 + ring.rightMm3);
}

function isSlot(ring: RingStock): boolean {
  return Math.min(ring.leftMm3, ring.rightMm3) / (ring.leftMm3 + ring.rightMm3) >= SLOT_MINORITY;
}

const FRONT_RIGHT: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, origin: 'front-right' };

describe('relief roughing cut direction (ADR-427)', () => {
  const cases: ReadonlyArray<readonly [CncCutDirection | undefined, DeviceProfile]> = [
    ['climb', DEFAULT_DEVICE_PROFILE],
    ['conventional', DEFAULT_DEVICE_PROFILE],
    [undefined, DEFAULT_DEVICE_PROFILE],
    ['climb', FRONT_RIGHT],
    ['conventional', FRONT_RIGHT],
  ];

  for (const [direction, device] of cases) {
    it(`keeps each ring's new stock on the ${direction ?? 'default'} side (${device.origin})`, () => {
      const rings = newStockByRing(reliefRoughing(direction, device), device).filter(
        (ring) => ring.leftMm3 + ring.rightMm3 > MIN_RING_VOLUME_MM3,
      );
      const oneSided = rings.filter((ring) => !isSlot(ring));
      for (const ring of oneSided) {
        // Before ADR-427 the rings inside the boundary put all but a few
        // percent of their new stock on the other side.
        expect(requestedShare(ring, direction), `ring at Z${ring.pass.zMm}`).toBeGreaterThan(
          1 - SLOT_MINORITY,
        );
      }
      // Rings around the field and rings around the plateau both run
      // one-sided, winding opposite ways (ADR-252's island mirror).
      expect(oneSided.filter((ring) => ring.clockwise).length).toBeGreaterThanOrEqual(2);
      expect(oneSided.filter((ring) => !ring.clockwise).length).toBeGreaterThanOrEqual(2);
      // Only the innermost rings cut a full-width slot, so most of the stock
      // goes on the requested side; outside in, every boundary ring slotted.
      const total = rings.reduce((sum, ring) => sum + ring.leftMm3 + ring.rightMm3, 0);
      const requested = rings.reduce(
        (sum, ring) => sum + requestedShare(ring, direction) * (ring.leftMm3 + ring.rightMm3),
        0,
      );
      expect(requested / total).toBeGreaterThan(0.8);
    }, 60_000);
  }

  it('cuts a layer with no direction exactly as Climb', () => {
    const unset = roughingGroup(reliefRoughing(undefined, DEFAULT_DEVICE_PROFILE));
    const climb = roughingGroup(reliefRoughing('climb', DEFAULT_DEVICE_PROFILE));
    expect(unset.passes).toEqual(climb.passes);
  });

  it('ends each level with its boundary ring, one stepover deep along the wall', () => {
    const device = DEFAULT_DEVICE_PROFILE;
    const rings = newStockByRing(reliefRoughing('climb', device), device);
    for (const levelZ of new Set(rings.map((ring) => ring.pass.zMm))) {
      const level = rings.filter((ring) => ring.pass.zMm === levelZ);
      const areas = level.map((ring) => Math.abs(signedAreaMm2(ring.pass.polyline)));
      const boundary = level[areas.indexOf(Math.max(...areas))];
      if (boundary === undefined) throw new Error('empty level');
      // The field's boundary ring is the largest and comes after every other
      // ring around the field; it meets only the wall's stock, on the right.
      expect(level.indexOf(boundary)).toBeGreaterThanOrEqual(level.length - 2);
      expect(isSlot(boundary)).toBe(false);
      expect(requestedShare(boundary, 'climb')).toBeGreaterThan(0.9);
    }
  }, 60_000);
});
