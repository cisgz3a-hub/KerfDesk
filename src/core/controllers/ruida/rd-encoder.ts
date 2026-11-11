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
import type { Vec2 } from '../../scene';
import type { RdReferencePoint } from './rd-file-commands';
import { writeRdJob } from './rd-job-writer';
import { planRdMotion, type RdMotionPart } from './rd-motion-plan';
import { splitRdPartsBySurfaceSpeed } from './rd-rotary-feed';
import { rotaryFeedMatchFor } from '../../output/rotary-surface-feed';
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
  /** A router layer: .rd is a laser job format (controller audit 2026-09-25 CN-3). */
  | { readonly kind: 'cnc-unsupported'; readonly layerId: string }
  | { readonly kind: 'too-many-layers'; readonly count: number }
  /** A Y rotary needs more surface-speed parts than a .rd file holds (ADR-127 Amd 5). */
  | { readonly kind: 'rotary-too-many-speeds'; readonly maxParts: number }
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
      /** On a scaled Y rotary: the dose range left by the speed classes (ADR-127 Amd 5). */
      readonly rotaryDose?: { readonly minDose: number; readonly maxDose: number };
    }
  | { readonly ok: false; readonly error: RdEncodeError };

export type RdEncodeOptions = {
  /** The export placement; it decides the file's reference-point mode. */
  readonly jobOrigin?: JobOriginPlacement;
};

const MAX_RD_LAYERS = 100;

export function encodeRdJob(
  job: Job,
  device: DeviceProfile,
  options: RdEncodeOptions = {},
): RdEncodeResult {
  const cutGroups: CutGroup[] = [];
  for (const group of job.groups) {
    if (group.kind === 'cnc') {
      return { ok: false, error: { kind: 'cnc-unsupported', layerId: group.layerId } };
    }
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
  const planned = planRdMotion(cutGroups);
  // Every segment collapsed to a single µm point: there is nothing to burn.
  if (planned.length === 0) return { ok: false, error: { kind: 'empty-job' } };
  const rotary = rotaryMotion(job, device, planned);
  if ('error' in rotary) return { ok: false, error: rotary.error };
  const payload = writeRdJob(rotary.motion, rdReferencePointFor(options.jobOrigin));
  return {
    ok: true,
    bytes: swizzleBytes(payload),
    motion: rotary.motion,
    ...(rotary.dose === undefined ? {} : { rotaryDose: rotary.dose }),
  };
}

type RotaryMotion =
  | {
      readonly motion: ReadonlyArray<RdMotionPart>;
      readonly dose?: { readonly minDose: number; readonly maxDose: number };
    }
  | { readonly error: RdEncodeError };

// ADR-127 Amd 5: on a scaled Y rotary each layer splits into parts by the
// speed that moves the part's surface at the layer speed; elsewhere the plan
// is unchanged, byte for byte.
function rotaryMotion(
  job: Job,
  device: DeviceProfile,
  planned: ReadonlyArray<RdMotionPart>,
): RotaryMotion {
  const match = rotaryFeedMatchFor(job, device.maxFeed);
  if (match === undefined) return { motion: planned };
  const split = splitRdPartsBySurfaceSpeed(planned, match, MAX_RD_LAYERS);
  if (split === null) return { error: { kind: 'rotary-too-many-speeds', maxParts: MAX_RD_LAYERS } };
  const speedError = speedRepresentationError(split.parts.map((part) => part.group));
  if (speedError !== null) return { error: speedError };
  return { motion: split.parts, dose: { minDose: split.minDose, maxDose: split.maxDose } };
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

/** A group speed a .rd file cannot carry, or null. */
function speedRepresentationError(groups: ReadonlyArray<CutGroup>): RdEncodeError | null {
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
  }
  return null;
}

function validateRepresentation(groups: ReadonlyArray<CutGroup>): RdEncodeError | null {
  const speedError = speedRepresentationError(groups);
  if (speedError !== null) return speedError;
  for (const group of groups) {
    for (let segmentIndex = 0; segmentIndex < group.segments.length; segmentIndex += 1) {
      const segment = group.segments[segmentIndex];
      if (segment === undefined) continue;
      const path = `layer(${group.layerId}).segments[${segmentIndex}]`;
      // ADR-626: a final pass with an overcut runs its own burn; check it too.
      const error =
        polylineCoordinateError(segment.polyline, `${path}.polyline`) ??
        (segment.finalPassBurn === undefined
          ? null
          : polylineCoordinateError(
              segment.finalPassBurn.polyline,
              `${path}.finalPassBurn.polyline`,
            ));
      if (error !== null) return error;
    }
  }
  return null;
}

function polylineCoordinateError(
  polyline: ReadonlyArray<Vec2>,
  path: string,
): RdEncodeError | null {
  for (let pointIndex = 0; pointIndex < polyline.length; pointIndex += 1) {
    const point = polyline[pointIndex];
    if (point === undefined) continue;
    for (const axis of ['x', 'y'] as const) {
      const valueUm = mmToUm(point[axis]);
      if (!isCoord35Encodable(valueUm)) {
        return {
          kind: 'coordinate-out-of-range',
          path: `${path}[${pointIndex}].${axis}`,
          valueUm,
          minUm: RUIDA_COORD35_MIN,
          maxUm: RUIDA_COORD35_MAX,
        };
      }
    }
  }
  return null;
}
