/**
 * T2-18: semantic G-code parser test helper.
 *
 * Pre-T2-18 the test suite had no semantic G-code parser — tests
 * relied on string `includes('G21')` or regex matches. This was
 * shallow protection: a test asserting `gcode.includes('M5')`
 * passed whether M5 appeared at the right spot, whether it was
 * the first or last one, whether modal state was correct when
 * emitted. Downstream effect: tests passed even when the actual
 * emission shape was wrong.
 *
 * `parseGcode(text)` walks the gcode line-by-line, tracks modal
 * state (units, distance mode, motion mode, laser modal, feed,
 * spindle, position, plane), classifies each line into a
 * `ParsedMove`, and computes per-burn / per-rapid / total bounds
 * plus a set of safety-invariant checks. Tests use these
 * derivations instead of brittle string matching.
 *
 * Pure function, no side effects. Lives under `tests/helpers/` so
 * the test runner's exclusion list (`tests/runner-auto-discovery.test.ts`
 * EXCLUDED_DIRS) skips it as a test file.
 *
 * Out of scope: full G-code parser (this is a TEST helper, not a
 * production tokenizer). Intentionally omitted: subroutines (M97/M98),
 * variable substitution (#100=...), parametric expressions, full
 * G-code parameter set (we recognize X/Y/Z/F/S/I/J — anything else
 * passes through transparently).
 */

import type { AABB } from '../../src/core/types';

export interface ModalState {
  units: 'mm' | 'inch' | null; // G21 / G20
  distanceMode: 'absolute' | 'relative' | null; // G90 / G91
  motionMode: 'G0' | 'G1' | 'G2' | 'G3' | null;
  laserMode: 'M3' | 'M4' | 'off'; // M3 / M4 / M5
  feed: number | null; // last F value
  spindle: number; // last S value
  position: { x: number; y: number; z: number };
  plane: 'G17' | 'G18' | 'G19' | null;
}

export type MoveKind = 'rapid' | 'cut' | 'arc' | 'modal' | 'comment' | 'realtime' | 'unknown';

export interface ParsedMove {
  lineIndex: number;
  rawLine: string;
  type: MoveKind;
  modalBefore: ModalState;
  modalAfter: ModalState;
  fromXY?: { x: number; y: number };
  toXY?: { x: number; y: number };
  feed?: number;
  spindleS?: number;
  /** Derived: true when motionMode is G0/G1/G2/G3 AND laserMode is M3/M4 AND spindle > 0. */
  laserOn?: boolean;
}

export interface GcodeInvariantChecks {
  startsLaserOff: boolean;
  endsLaserOff: boolean;
  unitsDeclared: boolean;
  distanceModeDeclared: boolean;
  /** True if no G0 (rapid) line has M3/M4 active AND spindle > 0. */
  noBurnDuringRapid: boolean;
  noNaN: boolean;
  noInfinity: boolean;
  /** Predicate: true if every observed S value is ≤ max. */
  spindleNeverExceedsMax: (max: number) => boolean;
  feedAlwaysPositive: boolean;
  finalLaserOff: boolean;
}

export interface ParsedGcode {
  moves: ParsedMove[];
  finalState: ModalState;
  /** Bounding box of moves where laserOn === true. Empty AABB when no burn moves observed. */
  burnBounds: AABB;
  /** Bounding box of G0 moves. */
  rapidBounds: AABB;
  /** Bounding box of all motion moves (any G0/G1/G2/G3). */
  totalBounds: AABB;
  asserts: GcodeInvariantChecks;
}

const INITIAL_STATE: ModalState = {
  units: null,
  distanceMode: null,
  motionMode: null,
  laserMode: 'off',
  feed: null,
  spindle: 0,
  position: { x: 0, y: 0, z: 0 },
  plane: null,
};

const EMPTY_AABB: AABB = {
  minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity,
};

function copyState(s: ModalState): ModalState {
  return {
    units: s.units,
    distanceMode: s.distanceMode,
    motionMode: s.motionMode,
    laserMode: s.laserMode,
    feed: s.feed,
    spindle: s.spindle,
    position: { ...s.position },
    plane: s.plane,
  };
}

function expandAabb(box: AABB, x: number, y: number): AABB {
  return {
    minX: Math.min(box.minX, x),
    minY: Math.min(box.minY, y),
    maxX: Math.max(box.maxX, x),
    maxY: Math.max(box.maxY, y),
  };
}

/**
 * Parse a single field of the form `<letter><number>` from a line.
 * Returns null if the letter is not present or its value is not finite.
 * Permissive — tolerates leading/trailing whitespace, integer or
 * floating-point values, optional sign.
 */
function readField(line: string, letter: string): number | null {
  const re = new RegExp(`(?:^|\\s)${letter}([+-]?\\d+(?:\\.\\d+)?)`, 'i');
  const m = line.match(re);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

function classifyLine(line: string): MoveKind {
  const trimmed = line.trim();
  if (trimmed.length === 0) return 'comment';
  // GRBL realtime bytes appear as raw byte values; the parser sees
  // text gcode only, but a line that is exactly one of these chars
  // could appear in handcrafted test fixtures.
  if (/^[\x18\x21\x7E]/.test(trimmed)) return 'realtime';
  if (trimmed.startsWith(';') || trimmed.startsWith('(')) return 'comment';
  // Modal-only setters (G21/G90 alone) without motion fields are 'modal'.
  if (/^G0\b/i.test(trimmed) && !/[XYZ]/i.test(trimmed)) return 'modal';
  if (/^G1\b/i.test(trimmed) && !/[XYZ]/i.test(trimmed)) return 'modal';
  if (/^G2\b/i.test(trimmed) || /^G3\b/i.test(trimmed)) return 'arc';
  if (/^G0\b/i.test(trimmed)) return 'rapid';
  if (/^G1\b/i.test(trimmed)) return 'cut';
  if (/^[GMFS$]/.test(trimmed)) return 'modal';
  return 'unknown';
}

export function parseGcode(text: string): ParsedGcode {
  const lines = text.split(/\r?\n/);
  const moves: ParsedMove[] = [];
  let state = copyState(INITIAL_STATE);

  let burnBounds: AABB = { ...EMPTY_AABB };
  let rapidBounds: AABB = { ...EMPTY_AABB };
  let totalBounds: AABB = { ...EMPTY_AABB };

  let everSawNaN = false;
  let everSawInfinity = false;
  let maxSpindle = 0;
  let everSawNonPositiveFeed = false;
  let everSawBurnDuringRapid = false;

  // Strip end-of-line comments so X12 ; foo doesn't confuse readField.
  const stripped = lines.map(line => line.replace(/;.*$/, '').replace(/\(.*?\)/g, ''));

  for (let i = 0; i < stripped.length; i++) {
    const raw = lines[i];
    const cleaned = stripped[i].trim();
    const before = copyState(state);

    if (cleaned.length === 0) {
      moves.push({
        lineIndex: i,
        rawLine: raw,
        type: 'comment',
        modalBefore: before,
        modalAfter: before,
      });
      continue;
    }

    // Modal updates — apply ALL setters present on the line, then
    // commit motion if a coord field is present.
    if (/\bG20\b/i.test(cleaned)) state.units = 'inch';
    if (/\bG21\b/i.test(cleaned)) state.units = 'mm';
    if (/\bG90\b/i.test(cleaned)) state.distanceMode = 'absolute';
    if (/\bG91\b/i.test(cleaned)) state.distanceMode = 'relative';
    if (/\bG17\b/i.test(cleaned)) state.plane = 'G17';
    if (/\bG18\b/i.test(cleaned)) state.plane = 'G18';
    if (/\bG19\b/i.test(cleaned)) state.plane = 'G19';
    if (/\bM3\b/i.test(cleaned)) state.laserMode = 'M3';
    if (/\bM4\b/i.test(cleaned)) state.laserMode = 'M4';
    if (/\bM5\b/i.test(cleaned)) state.laserMode = 'off';

    const sField = readField(cleaned, 'S');
    if (sField != null) {
      state.spindle = sField;
      if (sField > maxSpindle) maxSpindle = sField;
    }
    const fField = readField(cleaned, 'F');
    if (fField != null) {
      state.feed = fField;
      if (fField <= 0) everSawNonPositiveFeed = true;
    }

    // Detect motion command on this line.
    let motionMode: ModalState['motionMode'] = null;
    if (/\bG0\b/i.test(cleaned)) motionMode = 'G0';
    else if (/\bG1\b/i.test(cleaned)) motionMode = 'G1';
    else if (/\bG2\b/i.test(cleaned)) motionMode = 'G2';
    else if (/\bG3\b/i.test(cleaned)) motionMode = 'G3';

    if (motionMode != null) {
      state.motionMode = motionMode;
    }

    const xField = readField(cleaned, 'X');
    const yField = readField(cleaned, 'Y');
    const zField = readField(cleaned, 'Z');
    const hasMotion = (xField != null || yField != null || zField != null) && state.motionMode != null;

    let kind = classifyLine(cleaned);
    let moveFromXY: { x: number; y: number } | undefined;
    let moveToXY: { x: number; y: number } | undefined;

    if (hasMotion) {
      moveFromXY = { x: state.position.x, y: state.position.y };
      const isRelative = state.distanceMode === 'relative';
      let nx = state.position.x;
      let ny = state.position.y;
      let nz = state.position.z;
      if (xField != null) nx = isRelative ? state.position.x + xField : xField;
      if (yField != null) ny = isRelative ? state.position.y + yField : yField;
      if (zField != null) nz = isRelative ? state.position.z + zField : zField;

      if (Number.isNaN(nx) || Number.isNaN(ny) || Number.isNaN(nz)) everSawNaN = true;
      if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) everSawInfinity = true;

      state.position = { x: nx, y: ny, z: nz };
      moveToXY = { x: nx, y: ny };

      totalBounds = expandAabb(totalBounds, nx, ny);
      if (state.motionMode === 'G0') {
        rapidBounds = expandAabb(rapidBounds, nx, ny);
        // T2-18 invariant: G0 with active laser modal + spindle > 0 is unsafe.
        if (state.laserMode !== 'off' && state.spindle > 0) {
          everSawBurnDuringRapid = true;
        }
      }
    }

    // Determine final kind. classifyLine is a heuristic; if we
    // observed motion, refine.
    if (hasMotion && state.motionMode === 'G0') kind = 'rapid';
    else if (hasMotion && state.motionMode === 'G1') kind = 'cut';
    else if (hasMotion && (state.motionMode === 'G2' || state.motionMode === 'G3')) kind = 'arc';

    const laserOn = hasMotion && state.laserMode !== 'off' && state.spindle > 0;
    if (laserOn && moveToXY) {
      burnBounds = expandAabb(burnBounds, moveToXY.x, moveToXY.y);
    }

    moves.push({
      lineIndex: i,
      rawLine: raw,
      type: kind,
      modalBefore: before,
      modalAfter: copyState(state),
      fromXY: moveFromXY,
      toXY: moveToXY,
      feed: fField ?? undefined,
      spindleS: sField ?? undefined,
      laserOn,
    });
  }

  // First-non-comment-move and last-non-comment-move scan for invariants.
  const motionMoves = moves.filter(m => m.type === 'rapid' || m.type === 'cut' || m.type === 'arc');
  const startsLaserOff = motionMoves.length === 0
    ? true
    : motionMoves[0].modalBefore.laserMode === 'off';
  const endsLaserOff = state.laserMode === 'off';

  const asserts: GcodeInvariantChecks = {
    startsLaserOff,
    endsLaserOff,
    unitsDeclared: state.units !== null,
    distanceModeDeclared: state.distanceMode !== null,
    noBurnDuringRapid: !everSawBurnDuringRapid,
    noNaN: !everSawNaN,
    noInfinity: !everSawInfinity,
    spindleNeverExceedsMax: (max: number) => maxSpindle <= max,
    feedAlwaysPositive: !everSawNonPositiveFeed,
    finalLaserOff: state.laserMode === 'off',
  };

  return {
    moves,
    finalState: state,
    burnBounds,
    rapidBounds,
    totalBounds,
    asserts,
  };
}
