import { describe, expect, it } from 'vitest';
import * as three from 'three';
import { projectSketchToViewport } from './viewport-projection';
import { buildViewportOverlay } from './viewport-overlay';

const frame = { originMm: { x: 10, y: 20 }, widthMm: 100, heightMm: 80, thicknessMm: 6 };

describe('Design viewport endpoint projection', () => {
  it('matches the rendered endpoint at minimum dolly in a close oblique view', () => {
    const point = { x: 60, y: 60 };
    const overlay = buildViewportOverlay({
      sketch: { entities: [{ kind: 'line', id: 'source', start: { x: 58, y: 60 }, end: point }] },
      selectedIds: new Set(),
      draft: null,
      snapMm: null,
      frame,
    });
    const camera = new three.PerspectiveCamera(40, 800 / 600, 0.5, 20000);
    camera.up.set(0, 0, 1);
    camera.position.set(0, -Math.sqrt(8 ** 2 - 2 ** 2), 2);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const rendered = new three.Vector3()
      .fromArray(overlay.buckets[0]!.positions, 3)
      .project(camera);
    const renderedPixel = { x: (rendered.x + 1) * 400, y: (1 - rendered.y) * 300 };
    const stockPlane = new three.Vector3(0, 0, 0).project(camera);
    const stockPixel = { x: (stockPlane.x + 1) * 400, y: (1 - stockPlane.y) * 300 };
    // The old z=0 projection falls outside Extend's eight-pixel hit radius.
    expect(
      Math.hypot(stockPixel.x - renderedPixel.x, stockPixel.y - renderedPixel.y),
    ).toBeGreaterThan(8);
    const pickedPixel = projectSketchToViewport(three, camera, point, frame, 800, 600)!;
    expect(pickedPixel.x).toBeCloseTo(renderedPixel.x, 10);
    expect(pickedPixel.y).toBeCloseTo(renderedPixel.y, 10);
  });

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
