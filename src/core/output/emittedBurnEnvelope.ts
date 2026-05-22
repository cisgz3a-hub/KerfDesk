/**
 * T1-182 (external audit High #2 + #8): parse the EMITTED G-code
 * into canonical motion events and derive the burn envelope.
 *
 * The audit framed the problem as: "simulation is based on the
 * internal `Plan`, not the final emitted G-code. Footer return
 * motion, template G-code, modal state, relative-mode output, or
 * encoder quirks can differ from preview. The user may approve a
 * preview that is not the actual program."
 *
 * T1-182 ships the PARSER FOUNDATION so the preview, validators,
 * and support diagnostics can consume canonical motion events
 * derived from the actual output text (not from the upstream
 * `Plan`). Wiring the preview UI to consume this is deferred — but
 * now `ValidatedJobTicket.emittedBurnBounds` carries the real
 * burn envelope derived from the bytes we will stream to the
 * machine, and downstream code can compare it to plan-derived
 * bounds to catch divergence.
 *
 * Scope (intentional minimum):
 *   - Walks the gcode line-by-line tracking only the modal state
 *     that affects burn-envelope correctness: motion mode (G0/G1),
 *     distance mode (G90/G91), laser modal (M3/M4/M5), spindle S.
 *   - Recognizes G0/G1/M3/M4/M5/G90/G91 + X/Y/F/S word tokens.
 *   - Skips comments (`;` to EOL, and `(...)` parenthesized).
 *   - Ignores G2/G3 arcs (not emitted by the current GRBL strategy;
 *     a future arc-aware emitter would extend this parser).
 *   - Returns the burn AABB (laser-on G1 moves only) + a count of
 *     burn moves so callers can detect empty-burn artifacts.
 *
 * Out of scope (deferred to future tickets):
 *   - Subroutines (M97/M98), variable substitution (#100=...).
 *   - Parametric expressions.
 *   - Arc bound computation (would extend `burnBounds` to include
 *     arc bulge points).
 *   - I/J/K word parsing.
 *
 * Pure function. No singletons. No global reads.
 */
import type { AABB } from '../types';
import type { GcodeChunk } from './GcodeStreaming';

export interface EmittedBurnEnvelope {
  /**
   * Axis-aligned bounding box of all laser-ON G1 motion in the
   * emitted gcode. `null` when no burn move was emitted (a job
   * comprising only rapids / dwells — typically an empty / invalid
   * design).
   */
  readonly burnBounds: AABB | null;
  /**
   * Number of distinct G1 moves with laser ON (S > 0 in M3 or M4
   * mode). Useful for detecting empty / degenerate output.
   */
  readonly burnMoveCount: number;
  /**
   * Number of zero-distance G1 moves the parser observed (where the
   * declared target equalled the prior position). Pre-T1-180 these
   * could be stationary dwells; post-T1-180 they're emitted as
   * `; G1 skipped` comments so this counter should be 0 on a
   * post-T1-180 emission. Carried for regression-detection by
   * downstream checks.
   */
  readonly zeroDistanceLinearCount: number;
}

const ENV_EMPTY: AABB = {
  minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity,
};

interface EmittedBurnEnvelopeState {
  motionMode: 'G0' | 'G1' | 'G2' | 'G3' | null;
  distanceMode: 'absolute' | 'relative';
  laserMode: 'M3' | 'M4' | 'off';
  spindle: number;
  posX: number;
  posY: number;
  burnBounds: { minX: number; minY: number; maxX: number; maxY: number };
  burnMoveCount: number;
  zeroDistanceLinearCount: number;
}

interface GcodeWord {
  readonly letter: string;
  readonly value: number;
}

function createEmittedBurnEnvelopeState(): EmittedBurnEnvelopeState {
  return {
    motionMode: null,
    distanceMode: 'absolute',
    laserMode: 'off',
    spindle: 0,
    posX: 0,
    posY: 0,
    burnBounds: { ...ENV_EMPTY },
    burnMoveCount: 0,
    zeroDistanceLinearCount: 0,
  };
}

/**
 * T1-189 (extends T1-186): compute arc center from `R` word mode.
 *
 * GRBL accepts `G2/G3 X.. Y.. R..` as an alternative to I/J. The R
 * word specifies the arc radius; the center is computed from the
 * chord between start and end plus the GRBL sign convention:
 *
 *   - |R| < chordLength/2 → bad arc (chord longer than diameter);
 *     returns null so the caller skips the expansion.
 *   - +R = shorter arc (< 180° sweep)
 *   - -R = longer arc (> 180° sweep)
 *
 * Combined with direction (G2 = CW, G3 = CCW), the center sits on:
 *   - LEFT  of chord direction when (R > 0) === (direction === 'G3')
 *   - RIGHT of chord direction otherwise.
 *
 * Returns `{cx, cy}` or `null` for bad arcs (zero chord with R≠0,
 * |R| smaller than half-chord). The caller treats null as "skip
 * arc expansion; endpoints already added to the AABB."
 */
function centerFromRMode(
  direction: 'G2' | 'G3',
  x0: number, y0: number,
  x1: number, y1: number,
  r: number,
): { cx: number; cy: number } | null {
  const cdx = x1 - x0;
  const cdy = y1 - y0;
  const d = Math.hypot(cdx, cdy);
  // Zero-chord arc with R != 0 is ambiguous (could be a full circle
  // or just bad input). GRBL treats it as an error; we skip the
  // expansion (the endpoint, which equals the start, is already in
  // the AABB via expandWithArc's endpoint adds).
  if (d < 1e-9) return null;
  const h = d / 2;
  const absR = Math.abs(r);
  if (absR < h - 1e-6) return null; // chord longer than diameter — invalid
  const t = Math.sqrt(Math.max(0, absR * absR - h * h));
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  // Unit chord direction.
  const ux = cdx / d;
  const uy = cdy / d;
  // Left perpendicular = (-uy, ux); right perpendicular = (uy, -ux).
  const centerLeft = (r > 0) === (direction === 'G3');
  const px = centerLeft ? -uy : uy;
  const py = centerLeft ? ux : -ux;
  return { cx: mx + t * px, cy: my + t * py };
}

function expand(env: { minX: number; minY: number; maxX: number; maxY: number }, x: number, y: number): void {
  if (x < env.minX) env.minX = x;
  if (x > env.maxX) env.maxX = x;
  if (y < env.minY) env.minY = y;
  if (y > env.maxY) env.maxY = y;
}

/**
 * T1-186: expand an AABB with the cardinal-extremum points of a
 * G2 (CW) / G3 (CCW) circular arc from (x0, y0) to (x1, y1) centered
 * at (cx, cy). The arc's true bounding box extends to the four axis-
 * aligned compass points (cx+r, cy), (cx-r, cy), (cx, cy+r),
 * (cx, cy-r) ONLY IF those points lie on the arc segment. Endpoints
 * always contribute.
 *
 * Algorithm:
 *  1. Compute start angle θ0 = atan2(y0 - cy, x0 - cx), end angle
 *     θ1 = atan2(y1 - cy, x1 - cx).
 *  2. Normalize the sweep range so it points the same direction as
 *     the motion command (G2 = CW, G3 = CCW). When θ0 == θ1 (full
 *     circle) the arc covers all four extrema.
 *  3. For each compass extremum, check whether its angle (0, π/2, π,
 *     -π/2) lies within the swept range; if yes, expand the AABB.
 *
 * Off-arc center (start position not on the circle) is treated as
 * out-of-scope: the parser silently ignores the arc and the AABB is
 * not expanded. The emitter should never produce such gcode; the
 * defense is in the planner / preflight.
 */
function expandWithArc(
  env: { minX: number; minY: number; maxX: number; maxY: number },
  direction: 'G2' | 'G3',
  x0: number, y0: number,
  x1: number, y1: number,
  cx: number, cy: number,
): void {
  // Endpoints always contribute.
  expand(env, x0, y0);
  expand(env, x1, y1);

  const r0 = Math.hypot(x0 - cx, y0 - cy);
  const r1 = Math.hypot(x1 - cx, y1 - cy);
  // Bad arc: start and end radii must agree within rounding.
  if (Math.abs(r0 - r1) > 1e-3 || r0 < 1e-6) return;
  const r = r0;

  const θ0 = Math.atan2(y0 - cy, x0 - cx);
  const θ1 = Math.atan2(y1 - cy, x1 - cx);

  // Sweep length CCW from θ0 to θ1, in [0, 2π).
  let ccwSweep = θ1 - θ0;
  while (ccwSweep < 0) ccwSweep += 2 * Math.PI;
  // If endpoints coincide treat as a full circle.
  if (ccwSweep < 1e-9) ccwSweep = 2 * Math.PI;

  // The actual sweep:
  //   G3 = CCW = ccwSweep
  //   G2 = CW  = 2π - ccwSweep
  const sweepCcw = direction === 'G3' ? ccwSweep : -(2 * Math.PI - ccwSweep);
  // The arc's angular range, expressed as θ0 + t·sweepCcw, t ∈ [0,1].
  // We need to check whether each compass angle θ ∈ {0, π/2, π, -π/2}
  // lies in this range. Two helper checks: contains-angle(θ).
  const containsAngle = (θ: number): boolean => {
    // Find the (signed) angular offset from θ0 to θ in the same
    // direction as the sweep. For CCW sweep (positive), the offset
    // should be in [0, sweepCcw]. For CW (negative), in [sweepCcw, 0].
    let offset = θ - θ0;
    if (sweepCcw >= 0) {
      while (offset < 0) offset += 2 * Math.PI;
      return offset <= sweepCcw + 1e-9;
    }
    while (offset > 0) offset -= 2 * Math.PI;
    return offset >= sweepCcw - 1e-9;
  };

  const compass: { θ: number; x: number; y: number }[] = [
    { θ: 0,             x: cx + r, y: cy     },
    { θ: Math.PI / 2,   x: cx,     y: cy + r },
    { θ: Math.PI,       x: cx - r, y: cy     },
    { θ: -Math.PI / 2,  x: cx,     y: cy - r },
  ];
  for (const pt of compass) {
    if (containsAngle(pt.θ)) {
      expand(env, pt.x, pt.y);
    }
  }
}

/**
 * Strip GRBL comments from a line. Removes parenthesized comments
 * `(...)` and line-comments `;` to end-of-line. Mirrors the strip
 * used by `Output.ts` for the T1-26 defense-in-depth M5 check.
 */
function stripComments(line: string): string {
  return line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '');
}

/**
 * Parse a line into ordered word tokens (G/M/X/Y/F/S/etc). Keeping
 * order matters because one GRBL block can contain both a motion
 * modal and a distance modal, e.g. `G91 G1 X10`.
 */
function parseWords(line: string): GcodeWord[] {
  const result: GcodeWord[] = [];
  // Match letter-prefixed numeric tokens: e.g. `G1`, `X-12.34`, `X+.5`, `S1e3`.
  const re = /([A-Za-z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const letter = m[1].toUpperCase();
    const value = parseFloat(m[2]);
    if (Number.isFinite(value)) {
      result.push({ letter, value });
    }
  }
  return result;
}

export function analyzeEmittedBurnEnvelope(gcode: string): EmittedBurnEnvelope {
  const state = createEmittedBurnEnvelopeState();
  for (const raw of gcode.split(/\r?\n/)) {
    analyzeEmittedBurnEnvelopeLine(state, raw);
  }
  return finishEmittedBurnEnvelope(state);
}

function analyzeEmittedBurnEnvelopeLine(state: EmittedBurnEnvelopeState, raw: string): void {
  const stripped = stripComments(raw).trim();
  if (stripped.length === 0) return;
  const words = parseWords(stripped);

  let motion: 'G0' | 'G1' | 'G2' | 'G3' | null = null;
  let distanceMode = state.distanceMode;
  let xWord: number | undefined;
  let yWord: number | undefined;
  let iWord: number | undefined;
  let jWord: number | undefined;
  let rWord: number | undefined;

  for (const word of words) {
    if (word.letter === 'G') {
      if (word.value === 90) distanceMode = 'absolute';
      else if (word.value === 91) distanceMode = 'relative';
      else if (word.value === 0) motion = 'G0';
      else if (word.value === 1) motion = 'G1';
      else if (word.value === 2) motion = 'G2';
      else if (word.value === 3) motion = 'G3';
    } else if (word.letter === 'M') {
      if (word.value === 3) state.laserMode = 'M3';
      else if (word.value === 4) state.laserMode = 'M4';
      else if (word.value === 5) { state.laserMode = 'off'; state.spindle = 0; }
    } else if (word.letter === 'S') {
      state.spindle = word.value;
    } else if (word.letter === 'X') {
      xWord = word.value;
    } else if (word.letter === 'Y') {
      yWord = word.value;
    } else if (word.letter === 'I') {
      iWord = word.value;
    } else if (word.letter === 'J') {
      jWord = word.value;
    } else if (word.letter === 'R') {
      rWord = word.value;
    }
  }

  state.distanceMode = distanceMode;
  if (motion !== null) state.motionMode = motion;

  const hasMotionWord = xWord !== undefined || yWord !== undefined;
  if (!hasMotionWord || state.motionMode === null) return;

  let nextX = state.posX;
  let nextY = state.posY;
  if (state.distanceMode === 'absolute') {
    if (xWord !== undefined) nextX = xWord;
    if (yWord !== undefined) nextY = yWord;
  } else {
    if (xWord !== undefined) nextX = state.posX + xWord;
    if (yWord !== undefined) nextY = state.posY + yWord;
  }

  const zeroDistance = nextX === state.posX && nextY === state.posY;
  if (state.motionMode === 'G1') {
    if (zeroDistance) {
      state.zeroDistanceLinearCount++;
    } else if (state.laserMode !== 'off' && state.spindle > 0) {
      expand(state.burnBounds, state.posX, state.posY);
      expand(state.burnBounds, nextX, nextY);
      state.burnMoveCount++;
    }
  } else if ((state.motionMode === 'G2' || state.motionMode === 'G3') && state.laserMode !== 'off' && state.spindle > 0) {
    let cx: number;
    let cy: number;
    let arcValid = true;
    if (rWord !== undefined && iWord === undefined && jWord === undefined) {
      const c = centerFromRMode(state.motionMode, state.posX, state.posY, nextX, nextY, rWord);
      if (c === null) {
        expand(state.burnBounds, state.posX, state.posY);
        expand(state.burnBounds, nextX, nextY);
        state.burnMoveCount++;
        arcValid = false;
        cx = 0;
        cy = 0;
      } else {
        cx = c.cx;
        cy = c.cy;
      }
    } else {
      cx = state.posX + (iWord ?? 0);
      cy = state.posY + (jWord ?? 0);
    }
    if (arcValid) {
      expandWithArc(state.burnBounds, state.motionMode, state.posX, state.posY, nextX, nextY, cx, cy);
      state.burnMoveCount++;
    }
  }

  state.posX = nextX;
  state.posY = nextY;
}

function finishEmittedBurnEnvelope(state: EmittedBurnEnvelopeState): EmittedBurnEnvelope {
  const haveBurn = state.burnMoveCount > 0 && Number.isFinite(state.burnBounds.minX);
  return {
    burnBounds: haveBurn ? { ...state.burnBounds } : null,
    burnMoveCount: state.burnMoveCount,
    zeroDistanceLinearCount: state.zeroDistanceLinearCount,
  };
}

export async function analyzeEmittedBurnEnvelopeFromChunks(
  source: AsyncIterable<GcodeChunk>,
): Promise<EmittedBurnEnvelope> {
  const state = createEmittedBurnEnvelopeState();
  for await (const chunk of source) {
    for (const line of chunk.lines) {
      analyzeEmittedBurnEnvelopeLine(state, line);
    }
    if (chunk.isLast) break;
  }
  return finishEmittedBurnEnvelope(state);
}
