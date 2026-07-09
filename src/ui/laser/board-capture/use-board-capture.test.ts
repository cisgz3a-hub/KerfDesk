import { describe, expect, it } from 'vitest';
import {
  boardCaptureReducer,
  INITIAL_BOARD_CAPTURE,
  type BoardCaptureState,
} from './use-board-capture';

const P = (x: number, y: number): { x: number; y: number } => ({ x, y });

function withCorners(count: number): BoardCaptureState {
  let state = INITIAL_BOARD_CAPTURE;
  for (let i = 0; i < count; i += 1) {
    state = boardCaptureReducer(state, { type: 'capture', point: P(i, i) });
  }
  return state;
}

describe('boardCaptureReducer', () => {
  it('appends corners up to four, then ignores extra captures', () => {
    const four = withCorners(4);
    expect(four.corners).toHaveLength(4);
    const fifth = boardCaptureReducer(four, { type: 'capture', point: P(9, 9) });
    expect(fifth).toBe(four); // unchanged reference
  });

  it('undoes the last corner but not past empty', () => {
    const two = withCorners(2);
    const one = boardCaptureReducer(two, { type: 'undo' });
    expect(one.corners).toHaveLength(1);
    const empty = boardCaptureReducer(INITIAL_BOARD_CAPTURE, { type: 'undo' });
    expect(empty).toBe(INITIAL_BOARD_CAPTURE);
  });

  it('commits only with exactly four corners', () => {
    expect(boardCaptureReducer(withCorners(3), { type: 'commit' }).committed).toBe(false);
    const committed = boardCaptureReducer(withCorners(4), { type: 'commit' });
    expect(committed.committed).toBe(true);
  });

  it('freezes capture and undo once committed', () => {
    const committed = boardCaptureReducer(withCorners(4), { type: 'commit' });
    expect(boardCaptureReducer(committed, { type: 'capture', point: P(1, 1) })).toBe(committed);
    expect(boardCaptureReducer(committed, { type: 'undo' })).toBe(committed);
  });

  it('ignores a re-capture at (essentially) the previous corner — a double-click', () => {
    const one = boardCaptureReducer(INITIAL_BOARD_CAPTURE, { type: 'capture', point: P(50, 30) });
    // Exact same point again (stationary-head double-click) → ignored.
    expect(boardCaptureReducer(one, { type: 'capture', point: P(50, 30) }).corners).toHaveLength(1);
    // Sub-millimetre jitter is still the same corner → ignored.
    expect(
      boardCaptureReducer(one, { type: 'capture', point: P(50.3, 30.2) }).corners,
    ).toHaveLength(1);
    // A genuinely distinct corner is captured.
    expect(boardCaptureReducer(one, { type: 'capture', point: P(150, 30) }).corners).toHaveLength(
      2,
    );
  });

  it('commit-manual replaces corners with the synthesized four and commits', () => {
    const one = boardCaptureReducer(INITIAL_BOARD_CAPTURE, { type: 'capture', point: P(10, 10) });
    const four = [P(10, 10), P(110, 10), P(110, 70), P(10, 70)];
    const committed = boardCaptureReducer(one, { type: 'commit-manual', corners: four });
    expect(committed.committed).toBe(true);
    expect(committed.corners).toEqual(four);
  });

  it('commit-manual is a no-op without exactly four corners or once committed', () => {
    const one = boardCaptureReducer(INITIAL_BOARD_CAPTURE, { type: 'capture', point: P(10, 10) });
    expect(boardCaptureReducer(one, { type: 'commit-manual', corners: [P(0, 0)] })).toBe(one);
    const four = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)];
    const committed = boardCaptureReducer(one, { type: 'commit-manual', corners: four });
    expect(boardCaptureReducer(committed, { type: 'commit-manual', corners: four })).toBe(
      committed,
    );
  });

  it('reset returns to the initial state', () => {
    expect(boardCaptureReducer(withCorners(3), { type: 'reset' })).toEqual(INITIAL_BOARD_CAPTURE);
  });

  it('set-shape switches the shape and clears in-progress corners', () => {
    const circle = boardCaptureReducer(withCorners(2), { type: 'set-shape', shapeKind: 'circle' });
    expect(circle.shapeKind).toBe('circle');
    expect(circle.corners).toHaveLength(0);
    expect(circle.committed).toBe(false);
  });

  it('set-shape is a no-op once committed', () => {
    const committed = boardCaptureReducer(withCorners(4), { type: 'commit' });
    expect(boardCaptureReducer(committed, { type: 'set-shape', shapeKind: 'circle' })).toBe(
      committed,
    );
  });

  it('a circle captures at most the centre + one rim point', () => {
    let s = boardCaptureReducer(INITIAL_BOARD_CAPTURE, { type: 'set-shape', shapeKind: 'circle' });
    s = boardCaptureReducer(s, { type: 'capture', point: P(100, 100) }); // centre
    s = boardCaptureReducer(s, { type: 'capture', point: P(140, 100) }); // rim
    expect(s.corners).toHaveLength(2);
    expect(boardCaptureReducer(s, { type: 'capture', point: P(200, 200) })).toBe(s); // capped at 2
  });

  it('commit-circle records the diameter + shape once the centre is captured', () => {
    let s = boardCaptureReducer(INITIAL_BOARD_CAPTURE, { type: 'set-shape', shapeKind: 'circle' });
    s = boardCaptureReducer(s, { type: 'capture', point: P(100, 100) });
    const committed = boardCaptureReducer(s, { type: 'commit-circle', diameterMm: 90 });
    expect(committed.committed).toBe(true);
    expect(committed.shape).toEqual({ kind: 'circle', diameterMm: 90 });
  });

  it('commit-circle is a no-op without a centre, on a rect, or once committed', () => {
    const circleEmpty = boardCaptureReducer(INITIAL_BOARD_CAPTURE, {
      type: 'set-shape',
      shapeKind: 'circle',
    });
    expect(boardCaptureReducer(circleEmpty, { type: 'commit-circle', diameterMm: 90 })).toBe(
      circleEmpty,
    );
    const rectOne = boardCaptureReducer(INITIAL_BOARD_CAPTURE, { type: 'capture', point: P(0, 0) });
    expect(boardCaptureReducer(rectOne, { type: 'commit-circle', diameterMm: 90 })).toBe(rectOne);
    const centered = boardCaptureReducer(circleEmpty, { type: 'capture', point: P(10, 10) });
    const committed = boardCaptureReducer(centered, { type: 'commit-circle', diameterMm: 90 });
    expect(boardCaptureReducer(committed, { type: 'commit-circle', diameterMm: 50 })).toBe(
      committed,
    );
  });
});
