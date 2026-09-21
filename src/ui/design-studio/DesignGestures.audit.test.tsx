import { act, useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountControl } from '../image-editor/control-audit-test-support';
import { resetStore } from '../state/test-helpers';
import { useDesignStudioStore as studio } from './design-studio-store';
import { DesignCanvas } from './DesignCanvas';
import { DesignViewport3D } from './viewport3d/DesignViewport3D';
import { ShapeInspector } from './ShapeInspector';

const scene = vi.hoisted(() => ({
  pointerToSceneMm: vi.fn((x: number, y: number) => ({ x, y })),
  pxPerMmAtTarget: () => 1,
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
beforeEach(() => {
  resetStore();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  studio.setState({ session: null, stash: null });
  studio.getState().openStudio();
  studio.getState().setView({ panXmm: 0, panYmm: 0, pxPerMm: 1 });
  studio.getState().setTool('rect');
});
afterEach(() => vi.unstubAllGlobals());
async function pointer(target: EventTarget, kind: string, x: number, y: number): Promise<void> {
  await act(async () =>
    target.dispatchEvent(
      new MouseEvent(kind, { bubbles: true, clientX: x, clientY: y, buttons: 1 }),
    ),
  );
}

it.each(['2D', '3D'] as const)(
  '%s production canvas commits a rectangle through its pointer mapping and shared gesture machine',
  async (kind) => {
    const host = await mountControl(kind === '2D' ? <DesignCanvas /> : <DesignViewport3D />);
    const canvas = host.querySelector<HTMLCanvasElement>('canvas[aria-label]')!;
    await pointer(canvas, 'pointerdown', 20, 20);
    await pointer(canvas, 'pointermove', 60, 50);
    await pointer(canvas, 'pointerup', 60, 50);
    expect(studio.getState().session?.history.present.entities).toEqual([
      expect.objectContaining({
        kind: 'rect',
        origin: { x: 20, y: 20 },
        widthMm: 40,
        heightMm: 30,
      }),
    ]);
    expect(studio.getState().session?.history.past).toHaveLength(1);
    if (kind === '3D') expect(scene.pointerToSceneMm).toHaveBeenCalledWith(20, 20);
  },
);

it('precision header drag moves and clamps only the panel, then releases its pointer ownership', async () => {
  studio.getState().drawEntity({
    kind: 'rect',
    id: 'audit',
    origin: { x: 0, y: 0 },
    widthMm: 20,
    heightMm: 20,
    cornerRadiusMm: 0,
  });
  studio.getState().setSelection(['audit']);
  const geometry = studio.getState().session?.history.present;
  const host = await mountControl(<ShapeInspector />);
  const panel = host.querySelector('aside')!;
  const x = parseFloat(panel.style.left);
  const y = parseFloat(panel.style.top);
  await pointer(host.querySelector('header')!, 'pointerdown', x + 3, y + 3);
  await pointer(window, 'pointermove', x + 33, y + 43);
  expect(panel.style.left).toBe(`${x + 30}px`);
  expect(panel.style.top).toBe(`${y + 40}px`);
  await pointer(window, 'pointermove', -100, -100);
  expect(panel.style.left).toBe('0px');
  expect(panel.style.top).toBe('0px');
  await pointer(window, 'pointerup', 0, 0);
  await pointer(window, 'pointermove', 300, 300);
  expect(panel.style.left).toBe('0px');
  expect(studio.getState().session?.history.present).toBe(geometry);
});
