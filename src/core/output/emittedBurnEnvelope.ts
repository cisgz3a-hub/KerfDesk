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

function expand(env: { minX: number; minY: number; maxX: number; maxY: number }, x: number, y: number): void {
  if (x < env.minX) env.minX = x;
  if (x > env.maxX) env.maxX = x;
  if (y < env.minY) env.minY = y;
  if (y > env.maxY) env.maxY = y;
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
 * Parse a line into word tokens (G/M/X/Y/F/S/etc). Returns a map
 * `{ G?: number, M?: number, X?: number, ... }`. Unknown words are
 * silently dropped (out-of-scope letters).
 */
function parseWords(line: string): Record<string, number> {
  const result: Record<string, number> = {};
  // Match letter-prefixed numeric tokens: e.g. `G1`, `X-12.34`, `S1000`.
  const re = /([A-Za-z])(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const letter = m[1].toUpperCase();
    const value = parseFloat(m[2]);
    if (Number.isFinite(value)) {
      // Single-letter words: the last occurrence on a line wins.
      // GRBL semantics: G0 G1 on the same line is invalid; we keep
      // the last for safety (downstream code shouldn't rely on this).
      result[letter] = value;
    }
  }
  return result;
}

export function analyzeEmittedBurnEnvelope(gcode: string): EmittedBurnEnvelope {
  const lines = gcode.split(/\r?\n/);

  // Modal state.
  let motionMode: 'G0' | 'G1' | null = null;
  let distanceMode: 'absolute' | 'relative' = 'absolute';
  let laserMode: 'M3' | 'M4' | 'off' = 'off';
  let spindle = 0;
  let posX = 0;
  let posY = 0;

  const burnBounds = { ...ENV_EMPTY };
  let burnMoveCount = 0;
  let zeroDistanceLinearCount = 0;
  // We accumulate the "from" point into the AABB as well as the
  // "to" point because a burn segment is the LINE between two
  // points; both endpoints contribute to the envelope.

  for (const raw of lines) {
    const stripped = stripComments(raw).trim();
    if (stripped.length === 0) continue;
    const words = parseWords(stripped);

    // Distance mode transitions (G90 / G91).
    if (words.G === 90) distanceMode = 'absolute';
    if (words.G === 91) distanceMode = 'relative';

    // Laser modal transitions (M3 / M4 / M5).
    if (words.M === 3) laserMode = 'M3';
    if (words.M === 4) laserMode = 'M4';
    if (words.M === 5) { laserMode = 'off'; spindle = 0; }

    // Spindle / power. Tracked regardless of motion presence so a
    // bare `S0` (modal power change without motion) updates the
    // state for subsequent G1.
    if (words.S !== undefined) {
      spindle = words.S;
    }

    // Motion mode + endpoint computation. We only care about G0 / G1
    // for burn-envelope; G2 / G3 are out of scope.
    let motion: 'G0' | 'G1' | null = null;
    if (words.G === 0) motion = 'G0';
    else if (words.G === 1) motion = 'G1';
    if (motion !== null) motionMode = motion;

    const hasMotionWord = words.X !== undefined || words.Y !== undefined;
    if (!hasMotionWord || motionMode === null) continue;

    // Resolve target position with respect to distance mode.
    let nextX = posX;
    let nextY = posY;
    if (distanceMode === 'absolute') {
      if (words.X !== undefined) nextX = words.X;
      if (words.Y !== undefined) nextY = words.Y;
    } else {
      // Relative mode: increments.
      if (words.X !== undefined) nextX = posX + words.X;
      if (words.Y !== undefined) nextY = posY + words.Y;
    }

    const dx = nextX - posX;
    const dy = nextY - posY;
    const zeroDistance = dx === 0 && dy === 0;

    if (motionMode === 'G1') {
      if (zeroDistance) {
        zeroDistanceLinearCount++;
      } else if (laserMode !== 'off' && spindle > 0) {
        // Burn move: laser on at non-zero power. Both endpoints
        // contribute to the AABB.
        expand(burnBounds, posX, posY);
        expand(burnBounds, nextX, nextY);
        burnMoveCount++;
      }
    }

    posX = nextX;
    posY = nextY;
  }

  const haveBurn = burnMoveCount > 0 && Number.isFinite(burnBounds.minX);
  return {
    burnBounds: haveBurn ? { ...burnBounds } : null,
    burnMoveCount,
    zeroDistanceLinearCount,
  };
}
