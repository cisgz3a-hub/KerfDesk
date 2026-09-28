import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type Project, type Transform, type Vec2 } from '../../../core/scene';
import { DEFAULT_SNAP_SETTINGS } from '../snap-settings';
import { snapMoveToPoint, type MoveDragForSnap } from './move-point-snap';
import { projectWith, square } from './snap-scene.test-support';

const REACH_MM = 2;

describe('snapMoveToPoint', () => {
  it('snaps the grabbed corner of the moving object onto a corner of another', () => {
    const drag = moveDrag({ x: 9.5, y: 0.4 });
    const result = snap(drag, twoSquares(), { x: 19.7, y: 0.3 });

    expect(result?.transform.x).toBeCloseTo(20);
    expect(result?.transform.y).toBeCloseTo(0);
    expect(result?.marker).toEqual({ kind: 'node', pointMm: { x: 30, y: 0 } });
  });

  it('grabs the nearest point by distance, so a midpoint can land on a node', () => {
    // Pressed beside the moving square's top-edge midpoint (5, 0).
    const drag = moveDrag({ x: 5, y: 0.2 });
    const result = snap(drag, twoSquares(), { x: 25.3, y: 0.2 });

    expect(result?.transform.x).toBeCloseTo(25);
    expect(result?.transform.y).toBeCloseTo(0);
    expect(result?.marker?.pointMm).toEqual({ x: 30, y: 0 });
  });

  it('widens the grab search when the press is far from every point', () => {
    const big = square('moving', 0, 0, {}, 100);
    const target = square('target', 200, 200);
    // Pressed inside the square; the centre (50, 50) is the nearest point.
    const drag = moveDrag({ x: 30, y: 30 });
    const result = snap(drag, projectWith([big, target]), { x: 155.5, y: 154.8 });

    // The centre, carried to (205.5, 204.8), lands on the target's centre.
    expect(result?.marker).toEqual({ kind: 'center', pointMm: { x: 205, y: 205 } });
    expect(result?.transform.x).toBeCloseTo(155);
  });

  it('reads the grab point from the start of the drag, not the moved scene', () => {
    const drag = moveDrag({ x: 9.5, y: 0.4 });
    // Mid-drag, the store already holds the moving square at its new place.
    const moved = projectWith([square('moving', 19.7, 0.3), square('target', 30, 0)]);

    expect(snap(drag, moved, { x: 19.7, y: 0.3 })?.transform.x).toBeCloseTo(20);
  });

  it('never snaps to the moving objects themselves', () => {
    const drag = moveDrag({ x: 9.5, y: 0.4 });
    const alone = projectWith([square('moving', 0, 0)]);

    expect(snap(drag, alone, { x: 0.6, y: 0.2 })).toBeNull();
  });

  it('does nothing when snapping or every point kind is off', () => {
    const disabled = snapMoveToPoint({
      drag: moveDrag({ x: 9.5, y: 0.4 }),
      project: twoSquares(),
      proposedTransform: transformAt({ x: 19.7, y: 0.3 }),
      settings: { ...DEFAULT_SNAP_SETTINGS, enabled: false },
      radiusMm: REACH_MM,
    });
    const noKinds = snapMoveToPoint({
      drag: moveDrag({ x: 9.5, y: 0.4 }),
      project: twoSquares(),
      proposedTransform: transformAt({ x: 19.7, y: 0.3 }),
      settings: {
        ...DEFAULT_SNAP_SETTINGS,
        snapToNodes: false,
        snapToMidpoints: false,
        snapToCenters: false,
        snapToIntersections: false,
      },
      radiusMm: REACH_MM,
    });

    expect(disabled).toBeNull();
    expect(noKinds).toBeNull();
  });
});

function snap(
  drag: MoveDragForSnap,
  project: Project,
  at: Vec2,
): ReturnType<typeof snapMoveToPoint> {
  return snapMoveToPoint({
    drag,
    project,
    proposedTransform: transformAt(at),
    settings: DEFAULT_SNAP_SETTINGS,
    radiusMm: REACH_MM,
  });
}

function twoSquares(): Project {
  return projectWith([square('moving', 0, 0), square('target', 30, 0)]);
}

function moveDrag(startScenePoint: Vec2): MoveDragForSnap {
  return { kind: 'move', objectId: 'moving', startScenePoint, startTx: 0, startTy: 0 };
}

function transformAt(at: Vec2): Transform {
  return { ...IDENTITY_TRANSFORM, x: at.x, y: at.y };
}
