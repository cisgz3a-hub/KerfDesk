import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProject, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { mountControl } from '../image-editor/control-audit-test-support';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { DesignCanvas } from './DesignCanvas';
import { useDesignStudioStore as studio } from './design-studio-store';

const photo: RasterImage = {
  kind: 'raster-image',
  id: 'photo',
  source: 'photo.png',
  dataUrl: 'data:image/png;base64,AA==',
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  transform: IDENTITY_TRANSFORM,
  pixelWidth: 100,
  pixelHeight: 100,
  color: '#808080',
  dither: 'threshold',
  linesPerMm: 10,
};
beforeEach(() => {
  resetStore();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  const project = createProject();
  useStore.setState({ project: { ...project, scene: { ...project.scene, objects: [photo] } } });
  studio.setState({ session: null, stash: null });
  studio.getState().openStudio();
  studio.getState().setView({ panXmm: 0, panYmm: 0, pxPerMm: 1 });
});
afterEach(() => vi.unstubAllGlobals());
async function pointer(target: EventTarget, kind: string, x: number, y: number) {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent(kind, { bubbles: true, clientX: x, clientY: y, buttons: 1 }),
    );
  });
}
it('selects and opens a project photo without starting or committing a vector marquee/move', async () => {
  const select = vi.fn();
  const edit = vi.fn();
  const host = await mountControl(<DesignCanvas onSelectPhoto={select} onEditPhoto={edit} />);
  const canvas = host.querySelector<HTMLCanvasElement>('canvas[aria-label]')!;
  const before = studio.getState().session?.history;
  await pointer(canvas, 'pointerdown', 50, 50);
  expect(select).toHaveBeenLastCalledWith(photo.id);
  expect(studio.getState().session?.marquee).toBeNull();
  await pointer(canvas, 'pointermove', 60, 60);
  await pointer(canvas, 'pointerup', 60, 60);
  await pointer(canvas, 'dblclick', 50, 50);
  expect(edit).toHaveBeenCalledWith(photo.id);
  expect(studio.getState().session?.history).toBe(before);
  expect(useStore.getState().project.scene.objects[0]).toBe(photo);
});
it('draws over a photo and selects the new shape rather than intercepting drawing gestures', async () => {
  const select = vi.fn();
  const edit = vi.fn();
  studio.getState().setTool('rect');
  const host = await mountControl(<DesignCanvas onSelectPhoto={select} onEditPhoto={edit} />);
  const canvas = host.querySelector<HTMLCanvasElement>('canvas[aria-label]')!;
  await pointer(canvas, 'pointerdown', 20, 20);
  await pointer(canvas, 'pointermove', 60, 60);
  await pointer(canvas, 'pointerup', 60, 60);
  const entity = studio.getState().session?.history.present.entities[0];
  expect(entity?.kind).toBe('rect');
  await act(async () => studio.getState().setTool('select'));
  await pointer(canvas, 'pointerdown', 40, 40);
  await pointer(canvas, 'pointerup', 40, 40);
  expect(select).toHaveBeenLastCalledWith(null);
  expect(studio.getState().session?.selectedIds.has(entity!.id)).toBe(true);
  await pointer(canvas, 'dblclick', 40, 40);
  expect(edit).not.toHaveBeenCalled();
});
