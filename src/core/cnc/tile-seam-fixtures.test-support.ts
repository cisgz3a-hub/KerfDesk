// Shared scenes for the N4 tiling regressions: real compiled CNC jobs, so the
// tile programs under test are the ones a tiled save writes.

import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Job } from '../job';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type CncMachineConfig,
  type ImportedSvg,
  type Layer,
} from '../scene';
import type { CncTileRegistration } from '../scene/machine';
import { compileCncJob } from './compile-cnc-job';

export const BIT_MM = 3.175;
export const LAYER_ID = 'op';
const LAYER_COLORS = ['#2563eb', '#dc2626', '#16a34a'];

export type Rect = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export const REGISTRATION: CncTileRegistration = {
  toolId: 'em-3175',
  holeDiameterMm: 3.175,
  depthMm: 6,
  depthPerPassMm: 2,
  feedMmPerMin: 1000,
  plungeMmPerMin: 300,
  spindleRpm: 12000,
};

function rectangle(
  id: string,
  [x, y, w, h]: readonly [number, number, number, number],
  color = '#2563eb',
): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x, y },
              { x: x + w, y },
              { x: x + w, y: y + h },
              { x, y: y + h },
            ],
          },
        ],
      },
    ],
  };
}

/** Compile one rectangle (scene mm) on one CNC layer. */
export function compiledRectangle(
  size: { readonly w: number; readonly h: number },
  cnc: Partial<CncLayerSettings>,
  machine: CncMachineConfig = DEFAULT_CNC_MACHINE_CONFIG,
): Job {
  const layer: Layer = {
    ...createLayer({ id: LAYER_ID, color: '#2563eb' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, tabsEnabled: false, ...cnc },
  };
  return compileCncJob(
    { objects: [rectangle('part', [20, 20, size.w, size.h])], layers: [layer] },
    DEFAULT_DEVICE_PROFILE,
    machine,
  );
}

/** Compile several rectangles (scene mm x, y, w, h), each on its own CNC layer. */
export function compiledRectangles(
  items: ReadonlyArray<{
    readonly layerId: string;
    readonly at: readonly [number, number, number, number];
    readonly cnc: Partial<CncLayerSettings>;
  }>,
): Job {
  return compileCncJob(
    {
      objects: items.map(({ layerId, at }, index) => rectangle(layerId, at, LAYER_COLORS[index])),
      layers: items.map(({ layerId, cnc }, index) => ({
        ...createLayer({ id: layerId, color: LAYER_COLORS[index] ?? '#000000' }),
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, tabsEnabled: false, ...cnc },
      })),
    },
    DEFAULT_DEVICE_PROFILE,
    DEFAULT_CNC_MACHINE_CONFIG,
  );
}

/** The XY extent of every cut in a job (machine coordinates). */
export function jobBounds(job: Job): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    for (const pass of group.passes) {
      const points =
        pass.kind === 'contour' || pass.kind === 'helical-contour'
          ? pass.polyline
          : pass.kind === 'path3d'
            ? pass.points
            : [pass.start, pass.end];
      for (const point of points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

export function grow(rect: Rect, by: number): Rect {
  return {
    minX: rect.minX - by,
    minY: rect.minY - by,
    maxX: rect.maxX + by,
    maxY: rect.maxY + by,
  };
}

export function contains(rect: Rect, point: { readonly x: number; readonly y: number }): boolean {
  return (
    point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY
  );
}

/** A machine whose stock is exactly this rectangle. */
export function machineWithStock(stock: Rect): CncMachineConfig {
  return {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    stock: {
      ...DEFAULT_CNC_MACHINE_CONFIG.stock,
      thicknessMm: 12,
      originOffset: { x: stock.minX, y: stock.minY },
      widthMm: stock.maxX - stock.minX,
      heightMm: stock.maxY - stock.minY,
    },
  };
}
