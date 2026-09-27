import { describe, expect, it } from 'vitest';
import * as three from 'three';
import { orthographicHalfHeight, syncOrthographicCamera } from './camera-projection';
import { easeOutCubic, tweenPose, type CameraPose } from './camera-tween';
import { VIEWER3D_MOUSE_HINT, VIEWER3D_MOUSE_MAP, viewer3dDragAction } from './viewer3d-controls';

const length = (v: { x: number; y: number; z: number }): number => Math.hypot(v.x, v.y, v.z);

describe('tweenPose', () => {
  const from: CameraPose = { position: { x: 0, y: -100, z: 0 }, target: { x: 0, y: 0, z: 0 } };
  const to: CameraPose = { position: { x: 0, y: 0, z: 50 }, target: { x: 0, y: 0, z: 0 } };

  it('starts and lands exactly on the two poses', () => {
    expect(tweenPose(from, to, 0).position.y).toBeCloseTo(-100, 9);
    const end = tweenPose(from, to, 1).position;
    expect(end.x).toBeCloseTo(0, 9);
    expect(end.y).toBeCloseTo(0, 9);
    expect(end.z).toBeCloseTo(50, 9);
  });

  it('swings around the target instead of cutting through it', () => {
    const middle = tweenPose(from, to, 0.5).position;
    expect(length(middle)).toBeCloseTo(75, 6);
    expect(middle.y).toBeLessThan(0);
    expect(middle.z).toBeGreaterThan(0);
  });

  it('turns level through a half turn between opposite views', () => {
    const back: CameraPose = { position: { x: 0, y: 100, z: 0 }, target: from.target };
    const middle = tweenPose(from, back, 0.5).position;
    expect(middle.z).toBeCloseTo(0, 6);
    expect(length(middle)).toBeCloseTo(100, 6);
  });

  it('eases out and clamps', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 9);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe('syncOrthographicCamera', () => {
  it('frames the target plane at the same size as the perspective camera', () => {
    const perspective = new three.PerspectiveCamera(40, 2, 0.1, 1000);
    perspective.position.set(0, -200, 0);
    perspective.up.set(0, 0, 1);
    perspective.lookAt(0, 0, 0);
    const ortho = new three.OrthographicCamera();
    syncOrthographicCamera(ortho, perspective, 200, 500);
    const half = orthographicHalfHeight(200, 40);
    expect(ortho.top).toBeCloseTo(half, 9);
    expect(ortho.right).toBeCloseTo(half * 2, 9);
    expect(ortho.near).toBe(-500);
    // A point on the target plane at the frustum's top edge lands on the top
    // of the screen in both cameras.
    perspective.updateMatrixWorld();
    const edge = new three.Vector3(0, 0, half);
    expect(edge.clone().project(ortho).y).toBeCloseTo(1, 6);
    expect(edge.clone().project(perspective).y).toBeCloseTo(1, 6);
  });
});

describe('shared mouse map', () => {
  it('maps pointer buttons through the one table and describes it', () => {
    expect(viewer3dDragAction(0)).toBe(VIEWER3D_MOUSE_MAP.left);
    expect(viewer3dDragAction(1)).toBe(VIEWER3D_MOUSE_MAP.middle);
    expect(viewer3dDragAction(2)).toBe(VIEWER3D_MOUSE_MAP.right);
    expect(viewer3dDragAction(3)).toBeNull();
    expect(VIEWER3D_MOUSE_HINT).toContain('to orbit');
    expect(VIEWER3D_MOUSE_HINT).toContain('Scroll to zoom');
  });
});
