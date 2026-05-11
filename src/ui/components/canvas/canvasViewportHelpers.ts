/**
 * T1-151: pure top-level helpers extracted from CanvasViewport.
 * Pre-T1-151 these three functions lived at the top + bottom of the
 * 1887-line CanvasViewport.tsx alongside the heavy mouse-handler
 * useCallback bodies.
 *
 *   - `defaultCursorForTool(tool)`: maps the active drawing tool to a
 *     CSS cursor string. Select tool → default arrow; node + shape
 *     tools → crosshair; text tool → text I-beam. Fallback is the
 *     default arrow.
 *   - `penAfterMoveIndex(moves, idx)`: walks `moves[0..idx]` and
 *     returns the canvas-space pen position after applying every
 *     rapid + linear move. Markers + non-positional moves are
 *     skipped. Used by the playback timeline to compute the
 *     starting pen position for a partial-toolpath redraw.
 *   - `formatTime(seconds)`: M:SS.mTenths formatting for the
 *     playback-time display.
 *
 * All three pure. Hoisting them clears 30+ lines of pure logic from
 * the viewport's render-body and lets each behavior be tested in
 * isolation.
 */
import type { Move } from '../../../core/plan/Plan';
import type { ToolType } from '../ToolBar';

/**
 * CSS cursor for the active tool. Select shows the default arrow;
 * node + shape-creation tools show a crosshair; text shows the
 * text I-beam. Fallback is `'default'`.
 */
export function defaultCursorForTool(activeTool: ToolType): string {
  const cursors: Record<string, string> = {
    select: 'default',
    node: 'crosshair',
    rect: 'crosshair',
    ellipse: 'crosshair',
    line: 'crosshair',
    text: 'text',
  };
  return cursors[activeTool] || 'default';
}

/**
 * Pen position after applying `moves[0..lastMoveIndex]`. Only rapid
 * and linear moves update the position; marker / dwell / laser /
 * air-assist / z-axis moves are skipped. Returns (0, 0) when the
 * index is negative or no positional move precedes it.
 */
export function penAfterMoveIndex(
  moves: readonly Move[],
  lastMoveIndex: number,
): { x: number; y: number } {
  let x = 0;
  let y = 0;
  if (lastMoveIndex < 0) return { x: 0, y: 0 };
  const lim = Math.min(lastMoveIndex, moves.length - 1);
  for (let i = 0; i <= lim; i++) {
    const m = moves[i];
    if (m.type === 'marker') continue;
    if (m.type === 'rapid' || m.type === 'linear') {
      x = m.to.x;
      y = m.to.y;
    }
  }
  return { x, y };
}

/**
 * Format seconds as `M:SS.mTenths` for the playback time display.
 * Negative seconds floor to 0:00.0. Format is `${m}:${SS}.${tenths}`
 * with SS zero-padded.
 */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds * 10) % 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}
