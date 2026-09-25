// Where a calibration test lands when it joins an open design (ADR-381): the
// free bed area nearest the machine origin, clear of the operator's artwork
// and of enabled no-go zones. When nothing fits, the test goes to the origin
// corner anyway and the caller must say that it overlaps.
//
// The search runs on a coarse occupancy grid (at most 256 cells a side) laid
// out from the origin corner, so its cost does not depend on how much artwork
// the project holds.

import type { DeviceProfile, Origin } from '../devices';
import type { AABB } from '../scene';

export type TestPlacementReason = 'free-space' | 'no-free-space' | 'larger-than-bed';

export type TestPlacement = {
  /** Canvas position of the test's top-left corner. */
  readonly x: number;
  readonly y: number;
  readonly reason: TestPlacementReason;
};

export type TestPlacementDevice = Pick<
  DeviceProfile,
  'bedWidth' | 'bedHeight' | 'origin' | 'noGoZones'
>;

type Size = { readonly width: number; readonly height: number };

// Bed coordinates measured from the origin corner: u grows away from the
// origin's side edge, v away from its front or back edge.
type OriginFrame = { readonly flipX: boolean; readonly flipY: boolean; readonly center: boolean };

// Keeps the default 5 mm fill overscan on the bed and leaves a visible gap
// between the test and the operator's artwork.
const EDGE_MARGIN_MM = 5;
const CLEARANCE_MM = 5;
const MAX_GRID_CELLS_PER_AXIS = 256;

export function placeTestOnBed(
  size: Size,
  obstacles: ReadonlyArray<AABB>,
  device: TestPlacementDevice,
): TestPlacement {
  const frame = originFrame(device.origin);
  const fits =
    size.width + 2 * EDGE_MARGIN_MM <= device.bedWidth &&
    size.height + 2 * EDGE_MARGIN_MM <= device.bedHeight;
  if (!fits) return { ...originCorner(size, device, frame), reason: 'larger-than-bed' };
  const blocked = [
    ...obstacles.map((box) => toFrameBox(box, frame, device)),
    ...noGoZoneFrameBoxes(device, frame),
  ];
  const spot = nearestFreeSpot(size, blocked, device, frame);
  if (spot === null) return { ...originCorner(size, device, frame), reason: 'no-free-space' };
  return { ...fromFrame(spot, size, frame, device), reason: 'free-space' };
}

function originFrame(origin: Origin): OriginFrame {
  return {
    flipX: origin === 'front-right' || origin === 'rear-right',
    // The canvas is drawn with the machine's front at the bottom.
    flipY: origin === 'front-left' || origin === 'front-right' || origin === 'center',
    center: origin === 'center',
  };
}

// No-go zones are stored in machine coordinates, which are already measured
// from the origin corner; a center origin sits half a bed in from the corner.
function noGoZoneFrameBoxes(device: TestPlacementDevice, frame: OriginFrame): ReadonlyArray<AABB> {
  const offsetX = frame.center ? device.bedWidth / 2 : 0;
  const offsetY = frame.center ? device.bedHeight / 2 : 0;
  return device.noGoZones
    .filter((zone) => zone.enabled)
    .map((zone) => ({
      minX: Math.min(zone.x, zone.x + zone.width) + offsetX,
      minY: Math.min(zone.y, zone.y + zone.height) + offsetY,
      maxX: Math.max(zone.x, zone.x + zone.width) + offsetX,
      maxY: Math.max(zone.y, zone.y + zone.height) + offsetY,
    }));
}

function toFrameBox(box: AABB, frame: OriginFrame, device: TestPlacementDevice): AABB {
  const [minX, maxX] = frame.flipX
    ? [device.bedWidth - box.maxX, device.bedWidth - box.minX]
    : [box.minX, box.maxX];
  const [minY, maxY] = frame.flipY
    ? [device.bedHeight - box.maxY, device.bedHeight - box.minY]
    : [box.minY, box.maxY];
  return { minX, minY, maxX, maxY };
}

function fromFrame(
  spot: { readonly u: number; readonly v: number },
  size: Size,
  frame: OriginFrame,
  device: TestPlacementDevice,
): { readonly x: number; readonly y: number } {
  return {
    x: frame.flipX ? device.bedWidth - spot.u - size.width : spot.u,
    y: frame.flipY ? device.bedHeight - spot.v - size.height : spot.v,
  };
}

function originCorner(
  size: Size,
  device: TestPlacementDevice,
  frame: OriginFrame,
): { readonly x: number; readonly y: number } {
  if (frame.center) {
    return { x: (device.bedWidth - size.width) / 2, y: (device.bedHeight - size.height) / 2 };
  }
  const inset =
    size.width + 2 * EDGE_MARGIN_MM <= device.bedWidth &&
    size.height + 2 * EDGE_MARGIN_MM <= device.bedHeight
      ? EDGE_MARGIN_MM
      : 0;
  return fromFrame({ u: inset, v: inset }, size, frame, device);
}

function nearestFreeSpot(
  size: Size,
  blocked: ReadonlyArray<AABB>,
  device: TestPlacementDevice,
  frame: OriginFrame,
): { readonly u: number; readonly v: number } | null {
  const grid = occupancyGrid(blocked, device);
  let best: { u: number; v: number; cost: number } | null = null;
  for (
    let v = EDGE_MARGIN_MM;
    v + size.height <= device.bedHeight - EDGE_MARGIN_MM;
    v += grid.step
  ) {
    for (
      let u = EDGE_MARGIN_MM;
      u + size.width <= device.bedWidth - EDGE_MARGIN_MM;
      u += grid.step
    ) {
      const cost = placementCost(u, v, size, device, frame);
      if (best !== null && cost >= best.cost) continue;
      if (grid.isFree(u, v, size)) best = { u, v, cost };
    }
  }
  return best;
}

function placementCost(
  u: number,
  v: number,
  size: Size,
  device: TestPlacementDevice,
  frame: OriginFrame,
): number {
  if (!frame.center) return u * u + v * v;
  const du = u + size.width / 2 - device.bedWidth / 2;
  const dv = v + size.height / 2 - device.bedHeight / 2;
  return du * du + dv * dv;
}

type OccupancyGrid = {
  readonly step: number;
  readonly isFree: (u: number, v: number, size: Size) => boolean;
};

// A 2-D difference array marks every obstacle in O(1), one prefix pass turns
// it into blocked cells, and a summed-area table answers each candidate
// rectangle in O(1).
function occupancyGrid(blocked: ReadonlyArray<AABB>, device: TestPlacementDevice): OccupancyGrid {
  const step = Math.max(1, Math.max(device.bedWidth, device.bedHeight) / MAX_GRID_CELLS_PER_AXIS);
  const columns = Math.max(1, Math.ceil(device.bedWidth / step));
  const rows = Math.max(1, Math.ceil(device.bedHeight / step));
  const stride = columns + 1;
  const diff = new Int32Array(stride * (rows + 1));
  for (const box of blocked) {
    const i0 = Math.max(0, Math.floor((box.minX - CLEARANCE_MM) / step));
    const i1 = Math.min(columns - 1, Math.ceil((box.maxX + CLEARANCE_MM) / step) - 1);
    const j0 = Math.max(0, Math.floor((box.minY - CLEARANCE_MM) / step));
    const j1 = Math.min(rows - 1, Math.ceil((box.maxY + CLEARANCE_MM) / step) - 1);
    if (i1 < i0 || j1 < j0) continue;
    add(diff, j0 * stride + i0, 1);
    add(diff, j0 * stride + i1 + 1, -1);
    add(diff, (j1 + 1) * stride + i0, -1);
    add(diff, (j1 + 1) * stride + i1 + 1, 1);
  }
  const coverage = prefixSums(columns, rows, (i, j) => read(diff, j * stride + i));
  // sat[j * stride + i] = blocked cells in [0, i) x [0, j).
  const sat = prefixSums(columns, rows, (i, j) =>
    read(coverage, (j + 1) * stride + i + 1) > 0 ? 1 : 0,
  );
  return {
    step,
    isFree: (u, v, size) => {
      const i0 = Math.max(0, Math.floor(u / step));
      const j0 = Math.max(0, Math.floor(v / step));
      const i1 = Math.min(columns, Math.ceil((u + size.width) / step));
      const j1 = Math.min(rows, Math.ceil((v + size.height) / step));
      const blockedCells =
        read(sat, j1 * stride + i1) -
        read(sat, j0 * stride + i1) -
        read(sat, j1 * stride + i0) +
        read(sat, j0 * stride + i0);
      return blockedCells === 0;
    },
  };
}

// Padded 2-D prefix sum: out[(j + 1) * stride + i + 1] sums value over
// [0, i] x [0, j]. Row 0 and column 0 stay zero, so no lookup needs an edge
// check.
function prefixSums(
  columns: number,
  rows: number,
  value: (i: number, j: number) => number,
): Int32Array {
  const stride = columns + 1;
  const out = new Int32Array(stride * (rows + 1));
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) {
      const at = (j + 1) * stride + i + 1;
      out[at] =
        value(i, j) + read(out, at - 1) + read(out, at - stride) - read(out, at - stride - 1);
    }
  }
  return out;
}

function read(values: Int32Array, index: number): number {
  return values[index] ?? 0;
}

function add(values: Int32Array, index: number, delta: number): void {
  values[index] = read(values, index) + delta;
}
