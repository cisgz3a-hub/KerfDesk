// Shared fixtures for the holding-tab tests that measure the EMITTED program
// (compile-cnc-tab-holds.test.ts, ADR-258 Amendment 5; compile-cnc-tab-gaps.test.ts,
// Amendment 7). tab-bridge-measure.test-support.ts reads the G-code.

import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type Polyline,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';
import { maxOf, minOf } from '../util';
import { feedSegments, type Box, type FeedSegment } from './tab-bridge-measure.test-support';

export const COLOR = '#ff0000';
export const DEVICE = DEFAULT_DEVICE_PROFILE;
export const BIT = 3.175;
export const QUARTER = 6.35;
// Through 6.35 mm stock at 2 mm a pass; the default 2 mm tab tops out at -4.35.
export const THROUGH: Partial<CncLayerSettings> = { depthMm: 6.35, depthPerPassMm: 2 };
export const TAB_TOP = -4.35;

export function square(x: number, y: number, size: number): Polyline {
  return rectangle(x, y, size, size);
}

export function rectangle(x: number, y: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

export function circle(cx: number, cy: number, diameter: number): Polyline {
  return {
    closed: true,
    points: Array.from({ length: 128 }, (_, index) => {
      const angle = (index / 128) * Math.PI * 2;
      return { x: cx + (diameter / 2) * Math.cos(angle), y: cy + (diameter / 2) * Math.sin(angle) };
    }),
  };
}

export function art(
  polylines: ReadonlyArray<Polyline>,
  extra: Partial<ImportedSvg> = {},
): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 0, minY: 0, maxX: 300, maxY: 300 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: COLOR, polylines: [...polylines] }],
    ...extra,
  };
}

export function compiled(objects: ReadonlyArray<ImportedSvg>, cnc: Partial<CncLayerSettings>) {
  const layer = {
    ...createLayer({ id: 'L1', color: COLOR }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...THROUGH, ...cnc },
  };
  const job = compileCncJob(
    { objects: [...objects], layers: [layer] },
    DEVICE,
    DEFAULT_CNC_MACHINE_CONFIG,
  );
  return { job, segments: feedSegments(cncGrblStrategy.emit(job, DEVICE)) };
}

// The design-space box around a shape, in the machine coordinates the program uses.
export function machineBox(x: number, y: number, width: number, height: number, margin = 6): Box {
  const corners = [
    toMachineCoords({ x: x - margin, y: y - margin }, DEVICE),
    toMachineCoords({ x: x + width + margin, y: y + height + margin }, DEVICE),
  ];
  return {
    minX: minOf(corners.map((point) => point.x)),
    maxX: maxOf(corners.map((point) => point.x)),
    minY: minOf(corners.map((point) => point.y)),
    maxY: maxOf(corners.map((point) => point.y)),
  };
}

export function holeBox(cx: number, cy: number, diameter: number): Box {
  return machineBox(cx - diameter / 2, cy - diameter / 2, diameter, diameter, -0.01);
}

// Tab walls climbed from the full depth: one per tab on the deepest level.
export function tabRises(segments: ReadonlyArray<FeedSegment>, box: Box): number {
  return segments.filter(
    ({ a, b }) =>
      a.x === b.x &&
      a.y === b.y &&
      Math.abs(a.z + 6.35) < 1e-6 &&
      b.z > a.z &&
      a.x >= box.minX &&
      a.x <= box.maxX &&
      a.y >= box.minY &&
      a.y <= box.maxY,
  ).length;
}
