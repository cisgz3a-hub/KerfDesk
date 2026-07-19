import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../../core/scene';
import type { CapturedBoardGeometry } from '../../../core/scene/board-verification';
import {
  CIRCLE_RIM_POINT_COUNT,
  INITIAL_BOARD_CAPTURE,
  boardCaptureCanCommit,
  boardCaptureReducer,
  type BoardCaptureState,
  type BoardRegistrationEpoch,
} from './use-board-capture';

const EPOCH: BoardRegistrationEpoch = {
  controllerSessionEpoch: 2,
  trustedPositionEpoch: 4,
  workOriginVersion: 6,
};
const P = (x: number, y: number): Vec2 => ({ x, y });

function capture(state: BoardCaptureState, ...points: ReadonlyArray<Vec2>): BoardCaptureState {
  return points.reduce(
    (current, point) =>
      boardCaptureReducer(current, {
        type: 'capture',
        point,
        captureEpoch: EPOCH,
        expectedSessionRevision: current.sessionRevision,
      }),
    state,
  );
}

function commit(
  state: BoardCaptureState,
  geometry: CapturedBoardGeometry,
  registrationEpoch = EPOCH,
): BoardCaptureState {
  return boardCaptureReducer(state, {
    type: 'commit',
    geometry,
    registrationEpoch,
    outlineId: 'captured-board',
    expectedSessionRevision: state.sessionRevision,
  });
}

describe('boardCaptureReducer rectangle', () => {
  it('captures at most four distinct points and clears the epoch after undoing all', () => {
    let state = capture(
      INITIAL_BOARD_CAPTURE,
      P(0, 0),
      P(10, 0),
      P(0, 0),
      P(10, 5),
      P(0, 5),
      P(99, 99),
    );
    expect(state.corners).toHaveLength(4);
    expect(state.captureEpoch).toEqual(EPOCH);
    for (let index = 0; index < 4; index += 1) {
      state = boardCaptureReducer(state, { type: 'undo' });
    }
    expect(state.corners).toHaveLength(0);
    expect(state.captureEpoch).toBeNull();
  });

  it('rejects capture samples from a changed controller, position, or origin epoch', () => {
    const state = capture(INITIAL_BOARD_CAPTURE, P(0, 0));
    const changed = { ...EPOCH, controllerSessionEpoch: EPOCH.controllerSessionEpoch + 1 };
    const next = boardCaptureReducer(state, {
      type: 'capture',
      point: P(10, 0),
      captureEpoch: changed,
      expectedSessionRevision: state.sessionRevision,
    });
    expect(next).toBe(state);
  });

  it('rejects an async capture action from a replaced capture session', () => {
    const oldRevision = INITIAL_BOARD_CAPTURE.sessionRevision;
    const replaced = boardCaptureReducer(INITIAL_BOARD_CAPTURE, {
      type: 'set-shape',
      shapeKind: 'circle',
    });
    const stale = boardCaptureReducer(replaced, {
      type: 'capture',
      point: P(10, 10),
      captureEpoch: EPOCH,
      expectedSessionRevision: oldRevision,
    });
    expect(stale).toBe(replaced);
    expect(stale.corners).toHaveLength(0);
  });

  it('commits canonical measured and manual rectangles with an outline binding', () => {
    const geometry: CapturedBoardGeometry = {
      kind: 'rect',
      origin: P(10, 20),
      widthMm: 100,
      heightMm: 60,
    };
    const measured = capture(INITIAL_BOARD_CAPTURE, P(10, 20), P(110, 20), P(110, 80), P(10, 80));
    const committed = commit(measured, geometry);
    expect(committed).toMatchObject({
      committed: true,
      geometry,
      registrationEpoch: EPOCH,
      outlineId: 'captured-board',
    });
    expect(committed.corners).toEqual([P(10, 20), P(110, 20), P(110, 80), P(10, 80)]);
    expect(commit(capture(INITIAL_BOARD_CAPTURE, P(10, 20)), geometry).committed).toBe(true);
  });
});

describe('boardCaptureReducer circle', () => {
  it('defaults to four-point rim fitting and can switch to marked-center mode', () => {
    let state = boardCaptureReducer(INITIAL_BOARD_CAPTURE, {
      type: 'set-shape',
      shapeKind: 'circle',
    });
    expect(state.circleMethod).toBe('rim-fit');
    state = capture(state, P(0, 5), P(5, 0), P(0, -5), P(-5, 0), P(99, 99));
    expect(state.corners).toHaveLength(CIRCLE_RIM_POINT_COUNT);
    const marked = boardCaptureReducer(state, {
      type: 'set-circle-method',
      method: 'marked-center',
    });
    expect(marked).toMatchObject({
      corners: [],
      captureEpoch: null,
      circleMethod: 'marked-center',
    });
  });

  it('requires all four rim points and permits the intentional origin-version change', () => {
    const circle = boardCaptureReducer(INITIAL_BOARD_CAPTURE, {
      type: 'set-shape',
      shapeKind: 'circle',
    });
    const geometry: CapturedBoardGeometry = { kind: 'circle', center: P(10, 10), radiusMm: 5 };
    const three = capture(circle, P(10, 5), P(15, 10), P(10, 15));
    expect(commit(three, geometry).committed).toBe(false);
    const four = capture(three, P(5, 10));
    const afterOrigin = { ...EPOCH, workOriginVersion: EPOCH.workOriginVersion + 1 };
    expect(boardCaptureCanCommit(four, geometry, afterOrigin)).toBe(true);
    expect(commit(four, geometry, afterOrigin).committed).toBe(true);
  });

  it('keeps marked-center capture bound to the original work origin', () => {
    let state = boardCaptureReducer(INITIAL_BOARD_CAPTURE, {
      type: 'set-shape',
      shapeKind: 'circle',
    });
    state = boardCaptureReducer(state, {
      type: 'set-circle-method',
      method: 'marked-center',
    });
    state = capture(state, P(10, 10), P(15, 10));
    const geometry: CapturedBoardGeometry = { kind: 'circle', center: P(10, 10), radiusMm: 5 };
    expect(commit(state, geometry).committed).toBe(true);
    expect(commit(state, geometry, { ...EPOCH, workOriginVersion: 7 }).committed).toBe(false);
  });
});

describe('committed capture updates', () => {
  it('updates same-kind geometry and its origin identity while freezing capture changes', () => {
    const geometry: CapturedBoardGeometry = {
      kind: 'rect',
      origin: P(0, 0),
      widthMm: 100,
      heightMm: 60,
    };
    const committed = commit(capture(INITIAL_BOARD_CAPTURE, P(0, 0)), geometry);
    const updatedGeometry = { ...geometry, widthMm: 110 };
    const nextEpoch = { ...EPOCH, workOriginVersion: 7 };
    const updated = boardCaptureReducer(committed, {
      type: 'update-geometry',
      geometry: updatedGeometry,
      registrationEpoch: nextEpoch,
    });
    expect(updated).toMatchObject({ geometry: updatedGeometry, registrationEpoch: nextEpoch });
    expect(boardCaptureReducer(updated, { type: 'set-shape', shapeKind: 'circle' })).toBe(updated);
    expect(
      boardCaptureReducer(updated, {
        type: 'capture',
        point: P(9, 9),
        captureEpoch: EPOCH,
        expectedSessionRevision: updated.sessionRevision,
      }),
    ).toBe(updated);
  });

  it('reset returns to a fresh default rectangle session', () => {
    const circle = boardCaptureReducer(INITIAL_BOARD_CAPTURE, {
      type: 'set-shape',
      shapeKind: 'circle',
    });
    const reset = boardCaptureReducer(circle, { type: 'reset' });
    expect(reset).toMatchObject({
      shapeKind: 'rect',
      circleMethod: 'rim-fit',
      corners: [],
      committed: false,
    });
    expect(reset.sessionRevision).toBeGreaterThan(circle.sessionRevision);
  });
});
