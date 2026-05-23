/**
 * T1-139: pure GRBL job-bounds checker extracted from
 * `GrblController._checkJobBounds`. This is the controller-layer
 * defense-in-depth for out-of-bed motion — even if compile-time
 * preflight (which already runs its own bounds check) was somehow
 * skipped or fooled, this checker scans every G0/G1 X/Y move and
 * refuses the job if any of them would drive the head past the bed.
 *
 * The two modes the checker has to handle:
 *
 *   - Absolute (G90, default at start of job): X / Y in each move are
 *     the destination — direct comparison against `[-EPS, bedW+EPS]`
 *     and `[-EPS, bedH+EPS]`.
 *   - Relative (G91): X / Y are offsets from the current position. A
 *     virtual cursor (seeded from the controller's last confirmed
 *     head position) is advanced and compared each step. If the
 *     position is unknown (`positionConfirmed === false`), the job is
 *     refused outright — the (0,0) default is indistinguishable from
 *     "actually at origin" and a wrong guess can drive into limits.
 *
 * Pre-T1-139 this 60-line method lived inside the 2664-line
 * GrblController; testing the relative-mode + confirmation-gate
 * interaction required mounting the whole controller and stubbing
 * mock-port responses to set `_bedWidth` / `_state.position` /
 * `_positionConfirmed`. Post-T1-139 the rules live in this module
 * and the controller method is a 4-line wrapper.
 *
 * T1-108: deliberately O(n) — every line is inspected. Silently
 * accepting an out-of-bounds move after an arbitrary cap is worse
 * than refusing slowly.
 * T1-44: relative-mode lines are simulated against the current head
 * position rather than skipped.
 */

/** Inputs the bounds checker needs. Pure — no `this`, no singletons. */
export interface GrblJobBoundsContext {
  /** Bed width in mm. Non-positive values skip bounds checking entirely. */
  bedWidthMm: number;
  /** Bed height in mm. Non-positive values skip bounds checking entirely. */
  bedHeightMm: number;
  /** Current confirmed head position in machine coordinates. */
  headPosition: { x: number; y: number };
  /** Whether the head position has been confirmed by at least one status report. */
  positionConfirmed: boolean;
}

const EPS = 0.01;

export interface GrblJobBoundsState {
  relative: boolean;
  curX: number;
  curY: number;
  motionMode: 'g0' | 'g1' | null;
}

export function createGrblJobBoundsState(ctx: GrblJobBoundsContext): GrblJobBoundsState {
  return {
    relative: false,
    curX: ctx.headPosition.x,
    curY: ctx.headPosition.y,
    motionMode: null,
  };
}

function stripGrblComments(line: string): string {
  let out = '';
  let inParenComment = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inParenComment) {
      if (ch === ')') inParenComment = false;
      continue;
    }
    if (ch === ';') break;
    if (ch === '(') {
      inParenComment = true;
      continue;
    }
    out += ch;
  }
  return out;
}

interface GrblWord {
  letter: string;
  value: number;
}

function parseGrblWords(line: string): GrblWord[] {
  const words: GrblWord[] = [];
  for (const match of line.matchAll(/([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi)) {
    const value = Number(match[2]);
    if (Number.isFinite(value)) {
      words.push({ letter: match[1].toUpperCase(), value });
    }
  }
  return words;
}

export function checkGrblJobBoundsChunk(
  lines: ReadonlyArray<string>,
  ctx: GrblJobBoundsContext,
  state: GrblJobBoundsState = createGrblJobBoundsState(ctx),
): string | null {
  const { bedWidthMm: bedW, bedHeightMm: bedH } = ctx;
  if (!(bedW > 0) || !(bedH > 0)) {
    return null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = stripGrblComments(lines[i]);
    const words = parseGrblWords(line);
    let hasMotionWord = false;
    let x: number | null = null;
    let y: number | null = null;

    for (const word of words) {
      if (word.letter === 'G') {
        if (word.value === 90) state.relative = false;
        if (word.value === 91) state.relative = true;
        if (word.value === 0 || word.value === 1) {
          state.motionMode = word.value === 0 ? 'g0' : 'g1';
          hasMotionWord = true;
        }
      } else if (word.letter === 'X' && x === null) {
        x = word.value;
      } else if (word.letter === 'Y' && y === null) {
        y = word.value;
      }
    }

    if (x === null && y === null) continue;
    if (!hasMotionWord && state.motionMode == null) continue;

    if (state.relative) {
      // T1-44: refuse the job if we don't actually know where the head is.
      if (!ctx.positionConfirmed) {
        return (
          'Cannot accept relative-mode job: current head position is unknown. '
          + 'Reconnect to refresh status, then try again.'
        );
      }
      if (x !== null) state.curX += x;
      if (y !== null) state.curY += y;
    } else {
      if (x !== null) state.curX = x;
      if (y !== null) state.curY = y;
    }

    if (Number.isFinite(state.curX) && (state.curX < -EPS || state.curX > bedW + EPS)) {
      return (
        `Job out of bounds: position would reach X=${state.curX.toFixed(3)} but machine bed is `
        + `${bedW.toFixed(0)}mm wide. Recompile against the current profile or move the head.`
      );
    }
    if (Number.isFinite(state.curY) && (state.curY < -EPS || state.curY > bedH + EPS)) {
      return (
        `Job out of bounds: position would reach Y=${state.curY.toFixed(3)} but machine bed is `
        + `${bedH.toFixed(0)}mm tall. Recompile against the current profile or move the head.`
      );
    }
  }
  return null;
}

/**
 * Scan `lines` for G0/G1 X/Y moves that exceed the bed extents. Returns
 * `null` when every move stays in-bounds (or when `bedWidthMm` /
 * `bedHeightMm` is non-positive — bounds checking is skipped); otherwise
 * returns the user-facing error string the controller should throw.
 *
 * Relative-mode (G91) is supported via a virtual cursor seeded from
 * `headPosition`. If a relative move is encountered before the head
 * position has been confirmed (`positionConfirmed === false`), the
 * function returns the "Cannot accept relative-mode job" error so the
 * caller can reject the job rather than guess.
 */
export function checkGrblJobBounds(
  lines: ReadonlyArray<string>,
  ctx: GrblJobBoundsContext,
): string | null {
  return checkGrblJobBoundsChunk(lines, ctx);
}
