import { describe, expect, it } from 'vitest';
import {
  INITIAL_OUTLINE_PHOTO_SESSION,
  MAX_PHOTO_OUTLINE_POINTS,
  outlinePhotoSessionReducer,
  type OutlinePhotoAction,
  type OutlinePhotoSession,
} from './use-outline-photo-session';

const IMAGE = { data: new Uint8ClampedArray(16), width: 2, height: 2 };

function run(state: OutlinePhotoSession, ...actions: OutlinePhotoAction[]): OutlinePhotoSession {
  return actions.reduce(outlinePhotoSessionReducer, state);
}

const withPhoto = run(INITIAL_OUTLINE_PHOTO_SESSION, { type: 'photo-loaded', image: IMAGE });

function added(...points: ReadonlyArray<{ x: number; y: number }>): OutlinePhotoSession {
  return run(withPhoto, ...points.map((point) => ({ type: 'point-added' as const, point })));
}

describe('outline photo session', () => {
  it('ignores clicks until a photo is loaded', () => {
    expect(
      run(INITIAL_OUTLINE_PHOTO_SESSION, { type: 'point-added', point: { x: 1, y: 1 } }).points,
    ).toEqual([]);
  });

  it('adds, moves and clears outline points', () => {
    const three = added({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 });
    expect(three.points).toHaveLength(3);
    expect(run(three, { type: 'point-moved', index: 1, point: { x: 12, y: 1 } }).points[1]).toEqual(
      { x: 12, y: 1 },
    );
    expect(run(three, { type: 'points-cleared' }).points).toEqual([]);
  });

  it('undoes clicks, a whole drag, and a clear, one step at a time', () => {
    const three = added({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 });
    const dragged = run(
      three,
      { type: 'drag-started' },
      { type: 'point-moved', index: 1, point: { x: 11, y: 1 } },
      { type: 'point-moved', index: 1, point: { x: 12, y: 2 } },
    );
    expect(run(dragged, { type: 'undo' }).points).toEqual(three.points);
    const cleared = run(three, { type: 'points-cleared' });
    expect(run(cleared, { type: 'undo' }).points).toEqual(three.points);
    expect(run(three, { type: 'undo' }).points).toHaveLength(2);
    expect(run(withPhoto, { type: 'undo' })).toBe(withPhoto);
  });

  it('straightens the points between two picked ends, and undoes it', () => {
    const wobbly = added(
      { x: 0, y: 0 },
      { x: 100, y: 3 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    );
    const picking = run(
      wobbly,
      { type: 'straighten-started' },
      { type: 'straighten-point-picked', index: 0 },
    );
    expect(picking.straighten).toEqual({ from: 0 });
    const straight = run(picking, { type: 'straighten-point-picked', index: 2 });
    expect(straight.straighten).toBeNull();
    expect(straight.points[1]?.y).toBeCloseTo(0);
    expect(run(straight, { type: 'undo' }).points).toEqual(wobbly.points);
  });

  it('explains a refused straighten and lets the operator pick again', () => {
    const square = added({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 });
    const refused = run(
      square,
      { type: 'straighten-started' },
      { type: 'straighten-point-picked', index: 0 },
      { type: 'straighten-point-picked', index: 2 },
    );
    expect(refused.points).toEqual(square.points);
    expect(refused.straighten).toEqual({ from: null });
    expect(refused.error).toMatch(/too far off/);
    expect(run(refused, { type: 'straighten-cancelled' }).straighten).toBeNull();
  });

  it('forgets a first anchor whose point was undone', () => {
    const chosen = run(added({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }), {
      type: 'first-anchor-selected',
      index: 2,
    });
    expect(chosen.firstAnchor).toBe(2);
    expect(run(chosen, { type: 'undo' }).firstAnchor).toBeNull();
  });

  it('starts over on a new photo but keeps nothing from the old one', () => {
    const edited = run(
      withPhoto,
      { type: 'point-added', point: { x: 0, y: 0 } },
      { type: 'width-edited', value: '120' },
      { type: 'error', error: 'old' },
    );
    const reloaded = run(edited, { type: 'photo-loaded', image: IMAGE });
    expect(reloaded).toEqual({ ...INITIAL_OUTLINE_PHOTO_SESSION, image: IMAGE });
  });

  it('caps the number of points', () => {
    let state = withPhoto;
    for (let index = 0; index < MAX_PHOTO_OUTLINE_POINTS + 5; index += 1) {
      state = run(state, { type: 'point-added', point: { x: index, y: index * index } });
    }
    expect(state.points).toHaveLength(MAX_PHOTO_OUTLINE_POINTS);
  });
});
