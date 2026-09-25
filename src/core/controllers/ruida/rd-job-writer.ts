// Writes a planned .rd job as the UNswizzled command stream, in the order
// meerk40t's RuidaDriver drives RDJob (rdjob.py at 7e82652f): write_header
// (L1401-1504), then per layer write_settings (L1517-1548) + the moves +
// write_layer_end (L1511-1515), then write_tail (L1550-1554). Every value is
// a deterministic function of the plan and the reference point.

import {
  airAssist,
  blockEnd,
  cutAbsolute,
  laser2OffsetOff,
  laserDevice0,
  laserOffDelay,
  laserOnDelay,
  laserTubeStart,
  layerEnd,
  maxLayerPart,
  maxPower1,
  maxPower2,
  minPower1,
  minPower2,
  moveAbsolute,
  partColor,
  partMaxPoint,
  partMaxPointEx,
  partMaxPower1,
  partMaxPower2,
  partMinPoint,
  partMinPointEx,
  partMinPower1,
  partMinPower2,
  partSpeed,
  partWorkMode,
  selectLayer,
  speedLaser1,
} from './rd-commands';
import {
  arrayAdd,
  arrayDirection,
  arrayEnableMirrorCut,
  arrayMaxPoint,
  arrayMinPoint,
  arrayMirror,
  arrayRepeat,
  arrayStart,
  displayOffset,
  documentMaxPoint,
  documentMinPoint,
  enableBlockCutting,
  feedAutoPause,
  feedInfo,
  feedRepeat,
  fileEnd,
  fileSum,
  layerOffset,
  penOffset,
  processBottomRight,
  processRepeat,
  processTopLeft,
  referencePointMode,
  referencePointSet,
  setAbsolute,
  setCurrentElementIndex,
  startProcess,
  type RdReferencePoint,
} from './rd-file-commands';
import { unionBounds, type RdBoundsUm, type RdMotionPart } from './rd-motion-plan';
import { mmPerMinToUmPerSec } from './rd-numbers';

type PushFn = (bytes: ReadonlyArray<number>) => void;

// meerk40t writes these repeat records verbatim; its own comment on the
// E7 08 values is "Unknown." (rdjob.py L1423, L1504).
const PROCESS_REPEAT = [1, 1, 0, 0, 0, 0, 0] as const;
const ARRAY_REPEAT = [1, 1, 0, 1123, -3328, 4, 3480] as const;

/** Header, layers and tail for a non-empty plan (the caller refuses empty jobs). */
export function writeRdJob(
  parts: ReadonlyArray<RdMotionPart>,
  referencePoint: RdReferencePoint,
): number[] {
  const payload: number[] = [];
  const push: PushFn = (bytes) => {
    for (const byte of bytes) payload.push(byte);
  };
  writeHeader(push, parts, referencePoint);
  for (const part of parts) writeLayer(push, part);
  // write_tail: set_file_sum(file_sum() + 0xD7) — the sum of every unswizzled
  // byte written so far, plus the End Of File byte that follows the sum.
  let sum = 0;
  for (const byte of payload) sum += byte;
  push(fileSum(sum + 0xd7));
  push(fileEnd());
  return payload;
}

function writeHeader(
  push: PushFn,
  parts: ReadonlyArray<RdMotionPart>,
  referencePoint: RdReferencePoint,
): void {
  const job = unionBounds(parts);
  push(referencePointMode(referencePoint));
  push(setAbsolute());
  push(referencePointSet());
  push(enableBlockCutting(false));
  push(startProcess());
  push(feedRepeat(0, 0));
  push(feedAutoPause(0));
  push(processTopLeft(job.maxX, job.minY));
  push(processBottomRight(job.minX, job.maxY));
  push(documentMinPoint(job.maxX, job.minY));
  push(documentMaxPoint(job.minX, job.maxY));
  push(processRepeat(PROCESS_REPEAT));
  push(arrayDirection(0));
  for (const part of parts) writePartRecord(push, part);
  push(maxLayerPart(parts.length - 1));
  push(penOffset(0, 0));
  push(penOffset(1, 0));
  push(layerOffset(0, 0));
  push(layerOffset(1, 0));
  push(displayOffset(0, 0));
  push(feedInfo(0));
  writeArrayHeader(push, job);
}

function writePartRecord(push: PushFn, { part, group, bounds }: RdMotionPart): void {
  push(partSpeed(part, mmPerMinToUmPerSec(group.speed)));
  push(partMinPower1(part, group.power));
  push(partMaxPower1(part, group.power));
  push(partMinPower2(part, group.power));
  push(partMaxPower2(part, group.power));
  push(partColor(part, parseColor(group.color)));
  push(partWorkMode(part, 0));
  push(partMinPoint(part, bounds.minX, bounds.minY));
  push(partMaxPoint(part, bounds.maxX, bounds.maxY));
  push(partMinPointEx(part, bounds.minX, bounds.minY));
  push(partMaxPointEx(part, bounds.maxX, bounds.maxY));
}

function writeArrayHeader(push: PushFn, job: RdBoundsUm): void {
  push(arrayStart(0));
  push(setCurrentElementIndex(0));
  push(arrayEnableMirrorCut(0));
  push(arrayMinPoint(job.minX, job.minY));
  push(arrayMaxPoint(job.maxX, job.maxY));
  push(arrayAdd(0, 0));
  push(arrayMirror(0));
  push(arrayRepeat(ARRAY_REPEAT));
}

// The body sets the layer's ACTIVE speed, power and air: the part table
// above only stores per-part values (audit RU-1, RU-5).
function writeLayer(push: PushFn, { part, group, steps }: RdMotionPart): void {
  push(selectLayer(part));
  push(laserDevice0());
  push(airAssist(group.airAssist));
  push(speedLaser1(mmPerMinToUmPerSec(group.speed)));
  push(laserOnDelay(0));
  push(laserOffDelay(0));
  push(minPower1(group.power));
  push(maxPower1(group.power));
  push(minPower2(group.power));
  push(maxPower2(group.power));
  push(laserTubeStart(true));
  for (const step of steps) {
    push(step.cut ? cutAbsolute(step.xUm, step.yUm) : moveAbsolute(step.xUm, step.yUm));
  }
  push(blockEnd());
  push(layerEnd());
  push(laser2OffsetOff());
}

function parseColor(color: string): number {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (hex === null) return 0;
  return Number.parseInt(hex[1] ?? '0', 16);
}
