import { describe, expect, it } from 'vitest';
import * as three from 'three';
import { projectSketchToViewport } from './viewport-projection';

const frame = { originMm: { x: 10, y: 20 }, widthMm: 100, heightMm: 80, thicknessMm: 6 };

describe('Design viewport endpoint projection', () => {
  it('maps the translated stock centre to CSS pixels with the sketch Y direction', () => {
    const camera = new three.PerspectiveCamera(40, 2, 0.5, 20000);
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const center = projectSketchToViewport(three, camera, { x: 60, y: 60 }, frame, 800, 400);
    expect(center).toEqual({ x: 400, y: 200 });
    const lower = projectSketchToViewport(three, camera, { x: 60, y: 70 }, frame, 800, 400)!;
    expect(lower.x).toBeCloseTo(400);
    expect(lower.y).toBeGreaterThan(200);
  });

  it('rejects endpoints behind the camera and outside its clipping depth', () => {
    const camera = new three.PerspectiveCamera(40, 2, 0.5, 100);
    camera.position.set(0, 0, -10);
    camera.lookAt(0, 0, -20);
    camera.updateMatrixWorld(true);
    expect(projectSketchToViewport(three, camera, { x: 60, y: 60 }, frame, 800, 400)).toBeNull();
    camera.position.set(0, 0, 101);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    expect(projectSketchToViewport(three, camera, { x: 60, y: 60 }, frame, 800, 400)).toBeNull();
  });
});
