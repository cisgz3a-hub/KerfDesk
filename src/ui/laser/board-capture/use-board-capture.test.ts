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

  it('reset returns to the initial state', () => {
    expect(boardCaptureReducer(withCorners(3), { type: 'reset' })).toEqual(INITIAL_BOARD_CAPTURE);
  });
});
