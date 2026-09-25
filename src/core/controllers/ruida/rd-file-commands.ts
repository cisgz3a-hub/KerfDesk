// Ruida file-framing command builders (UNswizzled): the header meerk40t's
// RDJob.write_header writes before any layer (rdjob.py L1401-1504 at
// 7e82652f), the array records that close it, and the write_tail records.
// Same provenance and status as rd-commands.ts: public reverse-engineering,
// NOT hardware-verified in this repo.

import { encodeCoord35, encodeInt14 } from './rd-numbers';

type Bytes = ReadonlyArray<number>;

/** How the controller places the file's coordinates (rdjob.py L135-137):
 *  D8 10 Ref Point Mode 2 "Machine Zero/Absolute Position", D8 11 Ref Point
 *  Mode 1 "Anchor Point", D8 12 Ref Point Mode 0 "Current Position". */
export type RdReferencePoint = 'machine-zero' | 'anchor-point' | 'current-position';

const REFERENCE_POINT_BYTE: Readonly<Record<RdReferencePoint, number>> = {
  'machine-zero': 0x10,
  'anchor-point': 0x11,
  'current-position': 0x12,
};

// --- header preamble ---

/** 0xD8 0x10 / 0x11 / 0x12: the reference-point mode. */
export function referencePointMode(mode: RdReferencePoint): Bytes {
  return [0xd8, REFERENCE_POINT_BYTE[mode]];
}

/** 0xE6 0x01: Set Absolute. */
export function setAbsolute(): Bytes {
  return [0xe6, 0x01];
}

/** 0xF0: Ref Point Set. */
export function referencePointSet(): Bytes {
  return [0xf0];
}

/** 0xF1 0x02 <0|1>: Enable Block Cutting. */
export function enableBlockCutting(on: boolean): Bytes {
  return [0xf1, 0x02, on ? 0x01 : 0x00];
}

/** 0xD8 0x00: Start Process. */
export function startProcess(): Bytes {
  return [0xd8, 0x00];
}

/** 0xE7 0x06 <v*5> <v*5>: Feed Repeat. */
export function feedRepeat(first: number, second: number): Bytes {
  return [0xe7, 0x06, ...encodeCoord35(first), ...encodeCoord35(second)];
}

/** 0xE7 0x38 <v>: Set Feed Auto Pause. */
export function feedAutoPause(value: number): Bytes {
  return [0xe7, 0x38, value & 0x7f];
}

// --- job bounds. meerk40t passes the Ruida-native corners: "top-left" is
// (max x, min y) because native X grows toward the operator's left. ---

/** 0xE7 0x03 <x*5> <y*5>: Process TopLeft in µm. */
export function processTopLeft(xUm: number, yUm: number): Bytes {
  return point(0xe7, 0x03, xUm, yUm);
}

/** 0xE7 0x07 <x*5> <y*5>: Process BottomRight in µm. */
export function processBottomRight(xUm: number, yUm: number): Bytes {
  return point(0xe7, 0x07, xUm, yUm);
}

/** 0xE7 0x50 <x*5> <y*5>: Document Min Point in µm. */
export function documentMinPoint(xUm: number, yUm: number): Bytes {
  return point(0xe7, 0x50, xUm, yUm);
}

/** 0xE7 0x51 <x*5> <y*5>: Document Max Point in µm. */
export function documentMaxPoint(xUm: number, yUm: number): Bytes {
  return point(0xe7, 0x51, xUm, yUm);
}

/** 0xE7 0x04 <7 × v*2>: Process Repeat. */
export function processRepeat(values: ReadonlyArray<number>): Bytes {
  return [0xe7, 0x04, ...values.flatMap(encodeInt14)];
}

/** 0xE7 0x05 <direction>: Array Direction. */
export function arrayDirection(direction: number): Bytes {
  return [0xe7, 0x05, direction & 0x7f];
}

// --- offsets and feed ---

/** 0xE7 0x54 <axis> <coord*5>: Pen Offset in µm. */
export function penOffset(axis: number, um: number): Bytes {
  return [0xe7, 0x54, axis & 0x7f, ...encodeCoord35(um)];
}

/** 0xE7 0x55 <axis> <coord*5>: Layer Offset in µm. */
export function layerOffset(axis: number, um: number): Bytes {
  return [0xe7, 0x55, axis & 0x7f, ...encodeCoord35(um)];
}

/** 0xF1 0x03 <x*5> <y*5>: Display Offset in µm. */
export function displayOffset(xUm: number, yUm: number): Bytes {
  return point(0xf1, 0x03, xUm, yUm);
}

/** 0xE7 0x0A <v*5>: Feed Info. */
export function feedInfo(value: number): Bytes {
  return [0xe7, 0x0a, ...encodeCoord35(value)];
}

// --- array records (rdjob.py L1494-1504). meerk40t writes the Array Start
// here and never an Array End (0xEB); neither does this encoder. ---

/** 0xEA <index>: Array Start. */
export function arrayStart(index: number): Bytes {
  return [0xea, index & 0x7f];
}

/** 0xE7 0x60 <index>: Set Current Element Index. */
export function setCurrentElementIndex(index: number): Bytes {
  return [0xe7, 0x60, index & 0x7f];
}

/** 0xE7 0x0B <v>: Array En Mirror Cut. */
export function arrayEnableMirrorCut(value: number): Bytes {
  return [0xe7, 0x0b, value & 0x7f];
}

/** 0xE7 0x13 <x*5> <y*5>: Array Min Point in µm. */
export function arrayMinPoint(xUm: number, yUm: number): Bytes {
  return point(0xe7, 0x13, xUm, yUm);
}

/** 0xE7 0x17 <x*5> <y*5>: Array Max Point in µm. */
export function arrayMaxPoint(xUm: number, yUm: number): Bytes {
  return point(0xe7, 0x17, xUm, yUm);
}

/** 0xE7 0x23 <x*5> <y*5>: Array Add in µm. */
export function arrayAdd(xUm: number, yUm: number): Bytes {
  return point(0xe7, 0x23, xUm, yUm);
}

/** 0xE7 0x24 <v>: Array Mirror. */
export function arrayMirror(value: number): Bytes {
  return [0xe7, 0x24, value & 0x7f];
}

/** 0xE7 0x08 <7 × v*2>: Array Repeat. */
export function arrayRepeat(values: ReadonlyArray<number>): Bytes {
  return [0xe7, 0x08, ...values.flatMap(encodeInt14)];
}

// --- tail (meerk40t write_tail, rdjob.py L1550-1554) ---

/** 0xE5 0x05 <sum*5>: Set File Sum. */
export function fileSum(sum: number): Bytes {
  return [0xe5, 0x05, ...encodeCoord35(sum)];
}

/** 0xD7: End Of File. */
export function fileEnd(): Bytes {
  return [0xd7];
}

function point(op: number, sub: number, xUm: number, yUm: number): Bytes {
  return [op, sub, ...encodeCoord35(xUm), ...encodeCoord35(yUm)];
}
