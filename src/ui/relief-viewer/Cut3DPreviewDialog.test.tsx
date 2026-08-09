// Cut3DPreviewDialog (ADR-103 G4): dialog frame + jsdom no-WebGL fallback,
// same contract as the relief viewer (ADR-102 §4).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRemovalGrid } from '../../core/sim';
import { prepareCncCut3DSurface } from '../workspace/cnc-cut3d-surface';
import { Cut3DPreviewDialog } from './Cut3DPreviewDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

function grid() {
  const result = createRemovalGrid({
    originX: 0,
    originY: 0,
    widthMm: 40,
    heightMm: 30,
    mmPerCell: 1,
  });
  if (result.kind === 'error') throw new Error(result.reason);
  const g = result.grid;
  g.depth[0] = -3;
  return g;
}

function coarsenedGrid() {
  const result = createRemovalGrid({
    originX: 0,
    originY: 0,
    widthMm: 800,
    heightMm: 1,
    mmPerCell: 1,
    requestedMmPerCell: 0.25,
    resolutionReason: 'interactive-preview-cell-budget',
  });
  if (result.kind === 'error') throw new Error(result.reason);
  return result.grid;
}

function partialGrid() {
  const result = createRemovalGrid({
    originX: 0,
    originY: 0,
    widthMm: 1.4,
    heightMm: 0.6,
    mmPerCell: 1,
  });
  if (result.kind === 'error') throw new Error(result.reason);
  return result.grid;
}

describe('Cut3DPreviewDialog', () => {
  it('labels the exact stock size instead of count-times-pitch overhang', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <Cut3DPreviewDialog
            grid={partialGrid()}
            mesh={null}
            stockThicknessMm={6.35}
            onClose={() => undefined}
          />,
        );
      });

      expect(host.textContent).toContain('1.4 × 0.6 mm stock');
      expect(host.textContent).not.toContain('2 × 1 mm stock');
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('discloses the final bounded 3D mesh resolution', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <Cut3DPreviewDialog
            grid={coarsenedGrid()}
            mesh={null}
            stockThicknessMm={6.35}
            onClose={() => undefined}
          />,
        );
      });

      expect(host.querySelector('[role="status"]')?.textContent).toContain(
        '3D cut preview uses 3 mm cells instead of the requested 0.25 mm cells',
      );
      expect(host.textContent).toContain('3D display mesh budget');
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('renders the stock-sized dialog and falls back gracefully without WebGL', async () => {
    const onClose = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        const removalGrid = grid();
        root.render(
          <Cut3DPreviewDialog
            grid={removalGrid}
            mesh={prepareCncCut3DSurface(removalGrid)}
            stockThicknessMm={6.35}
            onClose={onClose}
          />,
        );
      });

      expect(host.querySelector('[role="dialog"]')).not.toBeNull();
      expect(host.textContent).toContain('40 × 30 mm stock');
      await vi.waitFor(
        async () => {
          await act(async () => Promise.resolve());
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

  it('keeps the dialog cancellable while background preparation is unavailable', async () => {
    const onClose = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <Cut3DPreviewDialog
            grid={grid()}
            mesh={null}
            unavailableReason="Background 3D preparation is unavailable."
            stockThicknessMm={6.35}
            onClose={onClose}
          />,
        );
      });
      expect(host.textContent).toContain(
        '3D view unavailable: Background 3D preparation is unavailable.',
      );
      const close = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Close',
      );
      if (close === undefined) throw new Error('Close button missing');
      await act(async () => close.click());
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});
