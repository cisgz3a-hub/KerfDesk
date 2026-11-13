// LMC list-word conversions (ADR-704), each as MeerK40t computes it at
// d511944e (balormk/controller.py): speeds in galvo units per ms (L1020-1032),
// frequency to period (L1034-1043), fiber power as a 12-bit current
// (L1045-1050), CO2/UV power as a ratio of the frequency (L948-961), the CO2/UV
// first-pulse-killer word (L976-989), signed delays as magnitude plus a sign
// word (L1217-1241), the polygon delay in 10 µs units (L1289-1300). Python's
// round() rounds halves to even; roundHalfEven keeps every word equal to
// MeerK40t's. Python's int() truncates toward zero; Math.trunc does the same.

import { galvoUnitsPerMm } from './galvo-field';

/** Python 3 round(): nearest integer, halves to the even neighbour. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** A speed in mm/s as galvo units per ms; null when it is 0 or above 0xFFFF
 *  (MeerK40t clamps the top; this build refuses instead, so a layer never
 *  marks at a speed other than the one it shows). */
export function lmcSpeedWord(mmPerSec: number, fieldMm: number): number | null {
  const word = Math.abs(Math.trunc((mmPerSec * galvoUnitsPerMm(fieldMm)) / 1000));
  return word >= 1 && word <= 0xffff ? word : null;
}

/** Fiber Q-switch period (base 20000) or CO2/UV mark frequency (base 10000). */
export function lmcPeriodWord(frequencyKhz: number, base: 20000 | 10000): number {
  return roundHalfEven(base / frequencyKhz) & 0xffff;
}

/** Fiber power: 0..100 % as 0..0xFFF. */
export function lmcMarkCurrentWord(powerPercent: number): number {
  return roundHalfEven((clampPercent(powerPercent) * 0xfff) / 100);
}

/** CO2/UV power: a ratio of the frequency, 200 × % / kHz. */
export function lmcPowerRatioWord(powerPercent: number, frequencyKhz: number): number {
  return Math.min(0xffff, roundHalfEven((200 * clampPercent(powerPercent)) / frequencyKhz));
}

/** CO2/UV first-pulse-killer word, 2000 / kHz (MeerK40t's formula reads only
 *  the frequency; its percent setting only gates the command). */
export function lmcFirstPulseKillerWord(frequencyKhz: number): number {
  return Math.min(0xffff, roundHalfEven(2000 / frequencyKhz));
}

/** A signed µs delay: [magnitude, 0x0000 or 0x8000 for negative]. */
export function lmcSignedDelayWords(delayUs: number): readonly [number, number] {
  return [Math.min(0xffff, Math.abs(Math.trunc(delayUs))), delayUs >= 0 ? 0x0000 : 0x8000];
}

/** Polygon delay in 10 µs units, 0..0xFFFF. */
export function lmcPolygonDelayWord(delayUs: number): number {
  return Math.trunc(Math.min(0xffff, Math.max(0, delayUs / 10)));
}

/** A list DelayTime word in 10 µs units, from µs. */
export function lmcDelayTimeWord(delayUs: number): number {
  return Math.min(0xffff, Math.abs(Math.trunc(delayUs / 10)));
}

/** Distance word of a jump or mark: the straight-line length in galvo units,
 *  at most 0xFFFF (controller.py L1147-1194). */
export function lmcDistanceWord(dx: number, dy: number): number {
  return Math.min(0xffff, Math.trunc(Math.hypot(dx, dy)));
}

function clampPercent(percent: number): number {
  return Math.max(0, Math.min(100, percent));
}
