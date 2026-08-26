// .rd job encoder (ADR-097). Assembles the minimal Ruida command stream for a
// vector cut job — bounds metadata, per-layer speed/power/color, travel + cut
// moves per segment and pass, EOF — then swizzles every byte. Deterministic:
// same Job + DeviceProfile → byte-identical output (non-negotiable #5, pinned
// by the same-process double-encode test in ruida.test.ts). NO reference .rd
// from real hardware or LightBurn exists to diff against yet — see the STATUS
// HONESTY note below and ADR-097.
//
// STATUS HONESTY: byte meanings follow public reverse-engineering; the
// encoder round-trips through this repo's own decoder (geometry/power/speed
// proven internally consistent) but NO output has been accepted by a real
// Ruida controller yet. Raster/image groups are refused rather than guessed.

import type { DeviceProfile } from '../../devices';
import type { Job } from '../../job';
import {
  blockEnd,
  cutAbsolute,
  fileEnd,
  jobMaxCorner,
  jobMaxCornerEx,
  jobMinCorner,
  jobMinCornerEx,
  layerColor,
  layerMaxPower,
  layerMinPower,
  layerSpeed,
  moveAbsolute,
  selectLayer,
  streamStart,
} from './rd-commands';
import {
  isCoord35Encodable,
  mmPerMinToUmPerSec,
  mmToUm,
  RUIDA_COORD35_MAX,
  RUIDA_COORD35_MIN,
} from './rd-numbers';
import { swizzleBytes } from './swizzle';

export type RdEncodeError =
  | { readonly kind: 'empty-job' }
  | { readonly kind: 'raster-unsupported'; readonly layerId: string }
  | { readonly kind: 'too-many-layers'; readonly count: number }
  | {
      readonly kind: 'coordinate-out-of-range';
      readonly path: string;
      readonly valueUm: number;
      readonly minUm: number;
      readonly maxUm: number;
    }
  | {
      readonly kind: 'speed-out-of-range';
      readonly layerId: string;
      readonly valueUmPerSec: number;
      readonly minUmPerSec: number;
      readonly maxUmPerSec: number;
    };

export type RdEncodeResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly error: RdEncodeError };

const MAX_RD_LAYERS = 100;

export function encodeRdJob(job: Job, device: DeviceProfile): RdEncodeResult {
  const cutGroups = [];
  for (const group of job.groups) {
    if (group.kind !== 'cut') {
      return { ok: false, error: { kind: 'raster-unsupported', layerId: group.layerId } };
    }
    cutGroups.push(group);
  }
  if (cutGroups.length === 0 || cutGroups.every((g) => g.segments.length === 0)) {
    return { ok: false, error: { kind: 'empty-job' } };
  }
  if (cutGroups.length > MAX_RD_LAYERS) {
    return { ok: false, error: { kind: 'too-many-layers', count: cutGroups.length } };
  }
  const representationError = validateRepresentation(cutGroups);
  if (representationError !== null) return { ok: false, error: representationError };

  const payload: number[] = [];
  const push = (bytes: ReadonlyArray<number>): void => {
    payload.push(...bytes);
  };

  push(streamStart());
  pushJobBounds(push, cutGroups, device);
  cutGroups.forEach((group, layerIndex) => {
    push(layerSpeed(layerIndex, mmPerMinToUmPerSec(group.speed)));
    push(layerMinPower(layerIndex, group.power));
    push(layerMaxPower(layerIndex, group.power));
    push(layerColor(layerIndex, parseColor(group.color)));
  });
  cutGroups.forEach((group, layerIndex) => {
    push(selectLayer(layerIndex));
    for (let pass = 0; pass < Math.max(1, group.passes); pass += 1) {
      for (const segment of group.segments) {
        pushSegment(push, segment.polyline, segment.closed);
      }
    }
  });
  push(blockEnd());
  push(fileEnd());
  return { ok: true, bytes: swizzleBytes(payload) };
}

function validateRepresentation(
  groups: ReadonlyArray<Extract<Job['groups'][number], { readonly kind: 'cut' }>>,
): RdEncodeError | null {
  for (const group of groups) {
    const speed = mmPerMinToUmPerSec(group.speed);
    if (!isCoord35Encodable(speed) || speed < 0) {
      return {
        kind: 'speed-out-of-range',
        layerId: group.layerId,
        valueUmPerSec: speed,
        minUmPerSec: 0,
        maxUmPerSec: RUIDA_COORD35_MAX,
      };
    }
    for (let segmentIndex = 0; segmentIndex < group.segments.length; segmentIndex += 1) {
      const segment = group.segments[segmentIndex];
      if (segment === undefined) continue;
      for (let pointIndex = 0; pointIndex < segment.polyline.length; pointIndex += 1) {
        const point = segment.polyline[pointIndex];
        if (point === undefined) continue;
        for (const axis of ['x', 'y'] as const) {
          const valueUm = mmToUm(point[axis]);
          if (!isCoord35Encodable(valueUm)) {
            return {
              kind: 'coordinate-out-of-range',
              path: `layer(${group.layerId}).segments[${segmentIndex}].polyline[${pointIndex}].${axis}`,
              valueUm,
              minUm: RUIDA_COORD35_MIN,
              maxUm: RUIDA_COORD35_MAX,
            };
          }
        }
      }
    }
  }
  return null;
}

type PushFn = (bytes: ReadonlyArray<number>) => void;
type Point = { readonly x: number; readonly y: number };

function pushSegment(push: PushFn, polyline: ReadonlyArray<Point>, closed: boolean): void {
  const first = polyline[0];
  if (first === undefined || polyline.length < 2) return;
  push(moveAbsolute(mmToUm(first.x), mmToUm(first.y)));
  for (let i = 1; i < polyline.length; i += 1) {
    const point = polyline[i];
    if (point === undefined) continue;
    push(cutAbsolute(mmToUm(point.x), mmToUm(point.y)));
  }
  if (closed) push(cutAbsolute(mmToUm(first.x), mmToUm(first.y)));
}

function pushJobBounds(
  push: PushFn,
  groups: ReadonlyArray<{
    readonly segments: ReadonlyArray<{ readonly polyline: ReadonlyArray<Point> }>;
  }>,
  _device: DeviceProfile,
): void {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const group of groups) {
    for (const segment of group.segments) {
      for (const point of segment.polyline) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
    }
  }
  if (!Number.isFinite(minX)) return;
  push(jobMinCorner(mmToUm(minX), mmToUm(minY)));
  push(jobMaxCorner(mmToUm(maxX), mmToUm(maxY)));
  push(jobMinCornerEx(mmToUm(minX), mmToUm(minY)));
  push(jobMaxCornerEx(mmToUm(maxX), mmToUm(maxY)));
}

function parseColor(color: string): number {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (hex === null) return 0;
  return Number.parseInt(hex[1] ?? '0', 16);
}
