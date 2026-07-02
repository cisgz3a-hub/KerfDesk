// jsdom has no WebGL, so the dialog's graceful fallback IS the testable
// path (ADR-101 §4): the real three.js import runs, the renderer fails to
// start, and the viewer reports it instead of crashing.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type ReliefObject } from '../../core/scene';
import { Relief3DViewerDialog } from './Relief3DViewerDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

function relief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'R1',
    source: 'model.stl',
    // One tilted triangle — enough for a real heightmap.
    meshPositions: [0, 0, 0, 10, 0, 2, 0, 10, 4],
    targetWidthMm: 50,
    reliefDepthMm: 5,
    emptyCells: 'floor',
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
  };
}

describe('Relief3DViewerDialog', () => {
  it('renders the dialog frame and falls back gracefully without WebGL', async () => {
    const onClose = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <Relief3DViewerDialog relief={relief()} stockThicknessMm={6.35} onClose={onClose} />,
        );
      });

      expect(host.querySelector('[role="dialog"]')).not.toBeNull();
      expect(host.textContent).toContain('model.stl');
      // jsdom: the three renderer cannot start → the fallback line shows
      // once the lazy import + scene setup settle (real task turns).
      await vi.waitFor(
        () => {
          expect(host.textContent).toContain('3D view unavailable');
        },
        { timeout: 20_000 },
      );

      const close = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Close',
      );
      if (close === undefined) throw new Error('Close button missing');
      await act(async () => {
        close.click();
      });
      expect(onClose).toHaveBeenCalled();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  }, 30_000);
});
