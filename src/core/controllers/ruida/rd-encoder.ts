// .rd job encoder (ADR-097). Assembles the Ruida command stream for a vector
// cut job in meerk40t's writer order — file header with the part table and
// array records, then per layer its own speed/power/air settings, travel + cut
// moves per segment and pass and the layer end, then the file sum and EOF —
// and swizzles every byte. Deterministic: same Job + DeviceProfile + options →
// byte-identical output (non-negotiable #5, pinned by the same-process
// double-encode test in ruida.test.ts and the golden bytes). NO reference .rd
// from real hardware or LightBurn exists to diff against yet — see the STATUS
// HONESTY note below and ADR-097.
//
// STATUS HONESTY: byte meanings follow public reverse-engineering; the
// encoder round-trips through this repo's own decoder and its output is read
// by meerk40t's RDJob parser with the layer speeds and powers intact, but NO
// output has been accepted by a real Ruida controller yet. Raster/image
// groups are refused rather than guessed.

import type { DeviceProfile } from '../../devices';
import type { CutGroup, Job, JobOriginPlacement } from '../../job';
import type { RdReferencePoint } from './rd-file-commands';
import { writeRdJob } from './rd-job-writer';
import { planRdMotion, type RdMotionPart } from './rd-motion-plan';
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
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      /** The moves the bytes command, per part, for the export's checks. */
      readonly motion: ReadonlyArray<RdMotionPart>;
    }
  | { readonly ok: false; readonly error: RdEncodeError };

export type RdEncodeOptions = {
  /** The export placement; it decides the file's reference-point mode. */
  readonly jobOrigin?: JobOriginPlacement;
};

const MAX_RD_LAYERS = 100;

export function encodeRdJob(
  job: Job,
  _device: DeviceProfile,
  options: RdEncodeOptions = {},
): RdEncodeResult {
  const cutGroups: CutGroup[] = [];
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
  const motion = planRdMotion(cutGroups);
  // Every segment collapsed to a single µm point: there is nothing to burn.
  if (motion.length === 0) return { ok: false, error: { kind: 'empty-job' } };
  const payload = writeRdJob(motion, rdReferencePointFor(options.jobOrigin));
  return { ok: true, bytes: swizzleBytes(payload), motion };
}

/** Audit RU-2 (lead's product decision): the reference-point mode follows the
 *  export placement. Absolute (or no placement) is machine coordinates from
 *  machine zero; User Origin and Verified Origin are relative to the anchor
 *  point set on the controller; Current Position is relative to the head. */
export function rdReferencePointFor(jobOrigin: JobOriginPlacement | undefined): RdReferencePoint {
  switch (jobOrigin?.startFrom) {
    case undefined:
    case 'absolute':
      return 'machine-zero';
    case 'user-origin':
    case 'verified-origin':
      return 'anchor-point';
    case 'current-position':
      return 'current-position';
  }
}

function validateRepresentation(groups: ReadonlyArray<CutGroup>): RdEncodeError | null {
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
