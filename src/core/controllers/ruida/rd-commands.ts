// Ruida command builders (UNswizzled payloads — the encoder swizzles last).
// Command bytes have the high bit set; data bytes are 7-bit. Opcodes and
// operand layouts follow meerk40t's ruida/rdjob.py at 7e82652f (opcode table
// L50-219, writers L1606-2244) and the EduTech wiki "Ruida" page — public
// reverse-engineering. Clean-room reimplementation; NOT hardware-verified in
// this repo — see the Ruida evidence note in the profile catalog.
//
// This file holds the motion, layer-body and part-table commands; the file
// header, array and tail records live in rd-file-commands.ts.

import { encodeCoord35, encodePower14 } from './rd-numbers';

type Bytes = ReadonlyArray<number>;

// --- motion ---

/** 0x88: travel (laser off) to absolute X,Y in µm. */
export function moveAbsolute(xUm: number, yUm: number): Bytes {
  return [0x88, ...encodeCoord35(xUm), ...encodeCoord35(yUm)];
}

/** 0xA8: cut (laser on) to absolute X,Y in µm. */
export function cutAbsolute(xUm: number, yUm: number): Bytes {
  return [0xa8, ...encodeCoord35(xUm), ...encodeCoord35(yUm)];
}

// --- layer body: the settings a layer runs with (meerk40t write_settings,
// rdjob.py L1517-1548). Only these set the ACTIVE speed and power; the header
// part table below only stores per-part values (rdjob.py L853-865, L904-911).

/** 0xCA 0x02 <part>: Layer Number — the part whose settings and geometry follow. */
export function selectLayer(part: number): Bytes {
  return [0xca, 0x02, part & 0x7f];
}

/** 0xCA 0x01 0x10: Laser Device 0 (the first laser tube). */
export function laserDevice0(): Bytes {
  return [0xca, 0x01, 0x10];
}

/** 0xCA 0x01 0x13 Air Assist On / 0xCA 0x01 0x12 Air Assist Off. */
export function airAssist(on: boolean): Bytes {
  return [0xca, 0x01, on ? 0x13 : 0x12];
}

/** 0xC9 0x02 <speed*5>: Speed Laser 1, the active cut speed in µm/s. */
export function speedLaser1(umPerSec: number): Bytes {
  return [0xc9, 0x02, ...encodeCoord35(umPerSec)];
}

/** 0xC6 0x12 <time*5>: Laser On Delay in ms, sent as µs. */
export function laserOnDelay(ms: number): Bytes {
  return [0xc6, 0x12, ...encodeCoord35(Math.round(ms * 1000))];
}

/** 0xC6 0x13 <time*5>: Laser Off Delay in ms, sent as µs. */
export function laserOffDelay(ms: number): Bytes {
  return [0xc6, 0x13, ...encodeCoord35(Math.round(ms * 1000))];
}

/** 0xC6 0x01 <power*2>: Power 1 min (laser 1), the active minimum power. */
export function minPower1(percent: number): Bytes {
  return [0xc6, 0x01, ...encodePower14(percent)];
}

/** 0xC6 0x02 <power*2>: Power 1 max (laser 1), the active maximum power. */
export function maxPower1(percent: number): Bytes {
  return [0xc6, 0x02, ...encodePower14(percent)];
}

/** 0xC6 0x21 <power*2>: Power 2 min (laser 2). */
export function minPower2(percent: number): Bytes {
  return [0xc6, 0x21, ...encodePower14(percent)];
}

/** 0xC6 0x22 <power*2>: Power 2 max (laser 2). */
export function maxPower2(percent: number): Bytes {
  return [0xc6, 0x22, ...encodePower14(percent)];
}

/** 0xCA 0x03 <0|1>: EnLaserTube Start. */
export function laserTubeStart(on: boolean): Bytes {
  return [0xca, 0x03, on ? 0x01 : 0x00];
}

// --- layer end (meerk40t write_layer_end, rdjob.py L1511-1515) ---

/** 0xE7 0x00: Block End — closes the layer's geometry. */
export function blockEnd(): Bytes {
  return [0xe7, 0x00];
}

/** 0xCA 0x01 0x00: End Layer. */
export function layerEnd(): Bytes {
  return [0xca, 0x01, 0x00];
}

/** 0xCA 0x01 0x30: EnLaser2Offset 0 (laser-2 offset off). */
export function laser2OffsetOff(): Bytes {
  return [0xca, 0x01, 0x30];
}

// --- header part table (meerk40t write_header, rdjob.py L1439-1473) ---

/** 0xC9 0x04 <part> <speed*5>: stored part speed in µm/s. */
export function partSpeed(part: number, umPerSec: number): Bytes {
  return [0xc9, 0x04, part & 0x7f, ...encodeCoord35(umPerSec)];
}

/** 0xC6 0x31 <part> <power*2>: stored part Power 1 min. */
export function partMinPower1(part: number, percent: number): Bytes {
  return [0xc6, 0x31, part & 0x7f, ...encodePower14(percent)];
}

/** 0xC6 0x32 <part> <power*2>: stored part Power 1 max. */
export function partMaxPower1(part: number, percent: number): Bytes {
  return [0xc6, 0x32, part & 0x7f, ...encodePower14(percent)];
}

/** 0xC6 0x41 <part> <power*2>: stored part Power 2 min. */
export function partMinPower2(part: number, percent: number): Bytes {
  return [0xc6, 0x41, part & 0x7f, ...encodePower14(percent)];
}

/** 0xC6 0x42 <part> <power*2>: stored part Power 2 max. */
export function partMaxPower2(part: number, percent: number): Bytes {
  return [0xc6, 0x42, part & 0x7f, ...encodePower14(percent)];
}

/** 0xCA 0x06 <part> <color*5>: part display color. Public .rd decoders
 *  read the packed int as blue<<16 | green<<8 | red — red in the LOW byte —
 *  so the 0xRRGGBB input swaps R and B on the wire (audit F8: the previous
 *  conversion read the channels swapped and repacked them swapped, a no-op
 *  that left red in the high byte). NOT hardware-verified. */
export function partColor(part: number, rgb: number): Bytes {
  const red = (rgb >> 16) & 0xff;
  const green = (rgb >> 8) & 0xff;
  const blue = rgb & 0xff;
  const packed = (blue << 16) | (green << 8) | red;
  return [0xca, 0x06, part & 0x7f, ...encodeCoord35(packed)];
}

/** 0xCA 0x41 <part> <mode>: part work mode (meerk40t always writes 0). */
export function partWorkMode(part: number, mode: number): Bytes {
  return [0xca, 0x41, part & 0x7f, mode & 0x7f];
}

/** 0xE7 0x52 / 0x53 / 0x61 / 0x62 <part> <x*5> <y*5>: part Min Point, Max
 *  Point, MinPointEx and MaxPointEx in µm. */
export function partMinPoint(part: number, xUm: number, yUm: number): Bytes {
  return partPoint(0x52, part, xUm, yUm);
}

export function partMaxPoint(part: number, xUm: number, yUm: number): Bytes {
  return partPoint(0x53, part, xUm, yUm);
}

export function partMinPointEx(part: number, xUm: number, yUm: number): Bytes {
  return partPoint(0x61, part, xUm, yUm);
}

export function partMaxPointEx(part: number, xUm: number, yUm: number): Bytes {
  return partPoint(0x62, part, xUm, yUm);
}

function partPoint(sub: number, part: number, xUm: number, yUm: number): Bytes {
  return [0xe7, sub, part & 0x7f, ...encodeCoord35(xUm), ...encodeCoord35(yUm)];
}

/** 0xCA 0x22 <part>: Max Layer — the highest part number in the file. */
export function maxLayerPart(part: number): Bytes {
  return [0xca, 0x22, part & 0x7f];
}
