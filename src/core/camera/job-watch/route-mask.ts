// A job's burn path drawn as masks over the watched part of the bed
// (ADR-490): the path itself at the beam's width, and a wider zone around it
// that a mark must stay inside to count as the burn. Lines arrive one at a
// time in bed millimetres, so a job with a million moves never needs an array
// of them. Pure core.

import type { BedArea } from '../model/camera-model-accuracy';

/** One byte per pixel, row-major; 1 = inside. */
export type BedMask = {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
};

/** Output pixel (0, 0) is the region's top-left corner; pixel centres sit at +0.5. */
export type MaskGrid = {
  readonly region: BedArea;
  readonly pixelsPerMm: number;
  readonly width: number;
  readonly height: number;
};

export function maskGrid(region: BedArea, pixelsPerMm: number): MaskGrid | null {
  const width = Math.round(region.width * pixelsPerMm);
  const height = Math.round(region.height * pixelsPerMm);
  return width > 0 && height > 0 ? { region, pixelsPerMm, width, height } : null;
}

export type RouteMasks = {
  readonly path: BedMask;
  readonly zone: BedMask;
};

export type RouteMaskBuilder = {
  /** A stretch of the path; `zoneOnly` marks it as allowed to show a burn without checking it. */
  readonly addLine: (x0: number, y0: number, x1: number, y1: number, zoneOnly?: boolean) => void;
  readonly masks: () => RouteMasks;
};

// A line marks every pixel whose square it crosses at the least, so a beam
// narrower than a pixel still draws an unbroken path.
const PIXEL_HALF_DIAGONAL = Math.SQRT1_2;

/**
 * Masks of a path `pathWidthMm` wide and of the zone `zoneMarginMm` beyond it
 * on each side.
 */
export function routeMaskBuilder(
  grid: MaskGrid,
  pathWidthMm: number,
  zoneMarginMm: number,
): RouteMaskBuilder {
  const path = new Uint8Array(grid.width * grid.height);
  const zone = new Uint8Array(grid.width * grid.height);
  const ppm = grid.pixelsPerMm;
  const pathRadius = Math.max((pathWidthMm / 2) * ppm, PIXEL_HALF_DIAGONAL);
  const zoneRadius = pathRadius + Math.max(0, zoneMarginMm) * ppm;
  const toPixelX = (x: number): number => (x - grid.region.x) * ppm - 0.5;
  const toPixelY = (y: number): number => (y - grid.region.y) * ppm - 0.5;
  const stamp: Stamp = {
    grid,
    path,
    zone,
    pathRadiusSq: pathRadius * pathRadius,
    zoneRadius,
    zoneRadiusSq: zoneRadius * zoneRadius,
  };
  return {
    addLine: (x0, y0, x1, y1, zoneOnly = false) => {
      const from = { x: toPixelX(x0), y: toPixelY(y0) };
      stampLine(stamp, from, { x: toPixelX(x1), y: toPixelY(y1) }, zoneOnly);
    },
    masks: () => ({
      path: { data: path, width: grid.width, height: grid.height },
      zone: { data: zone, width: grid.width, height: grid.height },
    }),
  };
}

type Stamp = {
  readonly grid: MaskGrid;
  readonly path: Uint8Array;
  readonly zone: Uint8Array;
  readonly pathRadiusSq: number;
  readonly zoneRadius: number;
  readonly zoneRadiusSq: number;
};

type PixelPoint = { readonly x: number; readonly y: number };

// Every pixel centre within the zone radius of the segment, in pixel units.
function stampLine(stamp: Stamp, a: PixelPoint, b: PixelPoint, zoneOnly: boolean): void {
  const { x: ax, y: ay } = a;
  const { x: bx, y: by } = b;
  if (![ax, ay, bx, by].every(Number.isFinite)) return;
  const { width, height } = stamp.grid;
  const r = stamp.zoneRadius;
  const x0 = Math.max(0, Math.ceil(Math.min(ax, bx) - r));
  const x1 = Math.min(width - 1, Math.floor(Math.max(ax, bx) + r));
  const y0 = Math.max(0, Math.ceil(Math.min(ay, by) - r));
  const y1 = Math.min(height - 1, Math.floor(Math.max(ay, by) + r));
  if (x1 < x0 || y1 < y0) return;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const index = y * width + x;
      // Dense fills stamp most pixels many times over; a path pixel is final.
      if (stamp.path[index] === 1) continue;
      const t = lengthSq > 0 ? clamp01(((x - ax) * dx + (y - ay) * dy) / lengthSq) : 0;
      const ex = ax + t * dx - x;
      const ey = ay + t * dy - y;
      const distanceSq = ex * ex + ey * ey;
      if (distanceSq > stamp.zoneRadiusSq) continue;
      stamp.zone[index] = 1;
      if (!zoneOnly && distanceSq <= stamp.pathRadiusSq) stamp.path[index] = 1;
    }
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
