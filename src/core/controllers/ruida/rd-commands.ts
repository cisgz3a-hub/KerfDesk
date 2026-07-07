// Ruida command builders (UNswizzled payloads — the encoder swizzles last).
// Command bytes have the high bit set; data bytes are 7-bit. The vocabulary
// below is the minimal cut-job subset documented by public reverse-engineering
// (MeerK40t, EduTech wiki). Clean-room reimplementation; byte meanings are
// commented per command. NOT hardware-verified in this repo — see the Ruida
// evidence note in the profile catalog.

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

// --- per-layer settings (part = layer index 0..) ---

/** 0xC9 0x04 <layer> <speed*5>: layer speed in µm/s. */
export function layerSpeed(layer: number, speedUmPerSec: number): Bytes {
  return [0xc9, 0x04, layer & 0x7f, ...encodeCoord35(speedUmPerSec)];
}

/** 0xC6 0x31 <layer> <power*2>: layer minimum power (channel 1). */
export function layerMinPower(layer: number, percent: number): Bytes {
  return [0xc6, 0x31, layer & 0x7f, ...encodePower14(percent)];
}

/** 0xC6 0x32 <layer> <power*2>: layer maximum power (channel 1). */
export function layerMaxPower(layer: number, percent: number): Bytes {
  return [0xc6, 0x32, layer & 0x7f, ...encodePower14(percent)];
}

/** 0xCA 0x06 <layer> <color*5>: layer display color. Public .rd decoders
 *  read the packed int as blue<<16 | green<<8 | red — red in the LOW byte —
 *  so the 0xRRGGBB input swaps R and B on the wire (audit F8: the previous
 *  conversion read the channels swapped and repacked them swapped, a no-op
 *  that left red in the high byte). NOT hardware-verified. */
export function layerColor(layer: number, rgb: number): Bytes {
  const red = (rgb >> 16) & 0xff;
  const green = (rgb >> 8) & 0xff;
  const blue = rgb & 0xff;
  const packed = (blue << 16) | (green << 8) | red;
  return [0xca, 0x06, layer & 0x7f, ...encodeCoord35(packed)];
}

/** 0xCA 0x02 <layer>: select the working layer for the geometry that follows. */
export function selectLayer(layer: number): Bytes {
  return [0xca, 0x02, layer & 0x7f];
}

// --- job frame metadata ---

/** 0xE7 0x03: job top-left (min) corner in µm. */
export function jobMinCorner(xUm: number, yUm: number): Bytes {
  return [0xe7, 0x03, ...encodeCoord35(xUm), ...encodeCoord35(yUm)];
}

/** 0xE7 0x07: job bottom-right (max) corner in µm. */
export function jobMaxCorner(xUm: number, yUm: number): Bytes {
  return [0xe7, 0x07, ...encodeCoord35(xUm), ...encodeCoord35(yUm)];
}

/** 0xE7 0x50 / 0x51: per-file bounds duplicates used by newer firmwares. */
export function jobMinCornerEx(xUm: number, yUm: number): Bytes {
  return [0xe7, 0x50, ...encodeCoord35(xUm), ...encodeCoord35(yUm)];
}

export function jobMaxCornerEx(xUm: number, yUm: number): Bytes {
  return [0xe7, 0x51, ...encodeCoord35(xUm), ...encodeCoord35(yUm)];
}

// --- stream framing ---

/** 0xD8 0x12: start-of-stream marker (upload begin). */
export function streamStart(): Bytes {
  return [0xd8, 0x12];
}

/** 0xEB: end of block / flush. */
export function blockEnd(): Bytes {
  return [0xeb];
}

/** 0xD7: end of file. */
export function fileEnd(): Bytes {
  return [0xd7];
}
