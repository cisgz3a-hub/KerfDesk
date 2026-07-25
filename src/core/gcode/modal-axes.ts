// Shared modal motion primitives (ADR-255 stage 1): the motion / units /
// distance G-word fold and the absolute-vs-incremental axis target math that
// both G-code parsers previously implemented separately.

import { INCH_TO_MM } from './word-scan';

export type AxisTriple = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

// Structural subset of both parsers' modal state objects — pass those
// objects directly; only these three fields are touched here.
export type CoreMotionModal = {
  motion: 0 | 1 | 2 | 3;
  unitScale: number;
  absolute: boolean;
};

/**
 * Applies the shared modal G words (G0–G3 motion, G20/G21 units, G90/G91
 * distance). Returns false when the code is none of them, so each caller
 * keeps its own policy for the rest (no-op table, unsupported note, …).
 */
export function applySharedGCode(state: CoreMotionModal, code: number): boolean {
  if (code === 0 || code === 1 || code === 2 || code === 3) state.motion = code;
  else if (code === 20) state.unitScale = INCH_TO_MM;
  else if (code === 21) state.unitScale = 1;
  else if (code === 90) state.absolute = true;
  else if (code === 91) state.absolute = false;
  else return false;
  return true;
}

/** Resolves an X/Y/Z target from modal words: missing axes hold, values scale
 * by the unit mode, and G91 accumulates onto the current position. */
export function resolveAxisTarget(
  current: AxisTriple,
  words: ReadonlyMap<string, number>,
  state: CoreMotionModal,
): AxisTriple {
  const axis = (name: string, currentValue: number): number => {
    const raw = words.get(name);
    if (raw === undefined) return currentValue;
    const scaled = raw * state.unitScale;
    return state.absolute ? scaled : currentValue + scaled;
  };
  return { x: axis('X', current.x), y: axis('Y', current.y), z: axis('Z', current.z) };
}
