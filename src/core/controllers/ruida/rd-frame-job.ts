// The Frame a Ruida network link runs (ADR-697): a .rd job that traces the
// job's bounding box with travel moves only. meerk40t documents no host-driven
// frame command (its panel Frame key, rdjob.py INTERFACE_FRAME on port 50207,
// frames whatever file the controller holds, not ours), so the frame is a job
// of its own. The same writer writes it with the job's reference-point mode
// and the job's header bounds, so the controller places it where it would
// place the job: in anchor-point mode the document min/max points decide that
// placement. Every move is 0x88 Move Absolute (laser off, rdjob.py
// MOVE_ABS_XY) and every power is 0, so nothing in it fires the tube.

import type { CutGroup } from '../../job';
import type { RdReferencePoint } from './rd-file-commands';
import { writeRdJob } from './rd-job-writer';
import { unionBounds, type RdBoundsUm, type RdMotionPart } from './rd-motion-plan';
import { RUIDA_SWIZZLE_MAGIC, swizzleBytes } from './swizzle';

/** The footprint a frame proves: the job's bounds and its reference mode.
 *  Start compares it with the frame's, so a moved, resized or re-anchored job
 *  needs a new Frame (PROJECT.md non-negotiable 21, ADR-565). */
export type RdFootprint = {
  readonly bounds: RdBoundsUm;
  readonly referencePoint: RdReferencePoint;
};

export function rdFootprint(
  motion: ReadonlyArray<RdMotionPart>,
  referencePoint: RdReferencePoint,
): RdFootprint | null {
  if (motion.length === 0) return null;
  return { bounds: unionBounds(motion), referencePoint };
}

export function sameRdFootprint(a: RdFootprint | null, b: RdFootprint | null): boolean {
  if (a === null || b === null) return false;
  return (
    a.referencePoint === b.referencePoint &&
    a.bounds.minX === b.bounds.minX &&
    a.bounds.minY === b.bounds.minY &&
    a.bounds.maxX === b.bounds.maxX &&
    a.bounds.maxY === b.bounds.maxY
  );
}

// The part the frame runs as. Its speed is the cut speed (C9 02), which no
// travel move uses: a Ruida travels at its own panel-set idle speed.
const FRAME_GROUP: CutGroup = {
  kind: 'cut',
  layerId: 'frame',
  color: '#000000',
  power: 0,
  speed: 6000,
  passes: 1,
  airAssist: false,
  segments: [],
};

/** The swizzled frame job: one part, travel only, around the footprint. */
export function encodeRdFrameJob(
  footprint: RdFootprint,
  magic: number = RUIDA_SWIZZLE_MAGIC,
): Uint8Array {
  const { bounds } = footprint;
  const { minX, minY, maxX, maxY } = bounds;
  const corners = [
    { xUm: minX, yUm: minY },
    { xUm: maxX, yUm: minY },
    { xUm: maxX, yUm: maxY },
    { xUm: minX, yUm: maxY },
    { xUm: minX, yUm: minY },
  ];
  const part: RdMotionPart = {
    part: 0,
    group: FRAME_GROUP,
    steps: corners.map((corner) => ({ ...corner, cut: false })),
    bounds,
  };
  return swizzleBytes(writeRdJob([part], footprint.referencePoint), magic);
}
