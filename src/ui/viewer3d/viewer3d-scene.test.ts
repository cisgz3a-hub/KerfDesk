// jsdom forces getContext('webgl') to null (jsdom-canvas-setup.ts), so the
// only automatable assertion is the graceful no-webgl fallback — everything
// past `new WebGLRenderer` is verified perceptually per ADR-255 §8.
import { describe, expect, it } from 'vitest';
import { createViewer3dScene } from './viewer3d-scene';

describe('createViewer3dScene', () => {
  it('returns the no-webgl fallback in jsdom instead of throwing', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const result = await createViewer3dScene(canvas);
    expect(result.kind).toBe('no-webgl');
    if (result.kind === 'no-webgl') {
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});
