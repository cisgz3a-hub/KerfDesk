import { act, useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clickControl, mountControl } from '../image-editor/control-audit-test-support';
import { resetStore } from '../state/test-helpers';
import { useStore } from '../state';
import { DesignStudioOverlay } from './DesignStudioOverlay';
import { useDesignStudioStore as studio } from './design-studio-store';
import { fitView } from './design-view';

const scene = vi.hoisted(() => ({
  updateOverlay: vi.fn(),
  setPreset: vi.fn(),
}));
vi.mock('./viewport3d/use-design-viewport-scene', () => ({
  useDesignViewportScene: () => ({
    canvasRef: useRef(null),
    handleRef: useRef(scene),
    state: 'ready',
  }),
}));
vi.mock('./DesignCanvas', () => ({
  DesignCanvas: () => (
    <div>
      <canvas aria-label="2D design canvas" />
    </div>
  ),
}));
vi.mock('./DesignOptionsBar', () => ({ DesignOptionsBar: () => null }));
vi.mock('./DesignToolRails', () => ({ DesignToolRails: () => null }));
vi.mock('./DesignStatusBar', () => ({ DesignStatusBar: () => null }));
vi.mock('./preview3d/DesignSidePanel', () => ({ DesignSidePanel: () => null }));

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  studio.setState({ session: null, stash: null });
  void studio.getState().openStudio();
  studio.getState().setView({ panXmm: 123, panYmm: 456, pxPerMm: 7 });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  });
});
afterEach(() => vi.restoreAllMocks());

async function fit(host: HTMLElement, input: 'button' | 'shortcut'): Promise<void> {
  if (input === 'button') return clickControl(host, 'Fit');
  await act(async () => {
    host
      .querySelector('[role="dialog"]')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'F', shiftKey: true, bubbles: true, cancelable: true }),
      );
  });
}

it.each(['button', 'shortcut'] as const)(
  'Fit %s frames the active 2D or 3D surface without changing the drawing',
  async (input) => {
    const host = await mountControl(<DesignStudioOverlay />);
    const history = studio.getState().session!.history;
    const workspace = useStore.getState().project.workspace;
    await fit(host, input);
    const expected2d = fitView({
      widthMm: workspace.width,
      heightMm: workspace.height,
      originXmm: 0,
      originYmm: 0,
      viewportWidthPx: 800,
      viewportHeightPx: 600,
    });
    expect(studio.getState().session!.view).toEqual(expected2d);
    expect(scene.setPreset).not.toHaveBeenCalled();

    await clickControl(host, '3D');
    const retained2dView = studio.getState().session!.view;
    await fit(host, input);
    expect(scene.setPreset).toHaveBeenCalledExactlyOnceWith('top');
    expect(studio.getState().session!.view).toBe(retained2dView);
    expect(studio.getState().session!.history).toBe(history);

    await clickControl(host, '3D');
    await fit(host, input);
    expect(studio.getState().session!.view).toEqual(expected2d);
    expect(scene.setPreset).toHaveBeenCalledTimes(1);
  },
);
