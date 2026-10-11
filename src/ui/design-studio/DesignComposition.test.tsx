import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProject, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { clickControl, mountControl } from '../image-editor/control-audit-test-support';
import { useImageEditorStore } from '../image-editor/image-editor-store';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { DesignStudioOverlay } from './DesignStudioOverlay';
import { useDesignStudioStore as studio } from './design-studio-store';
import { DesignProjectPhotoList } from './DesignProjectPhotoList';
import type { DesignPhotoActions } from './design-project-photos';

vi.mock('./DesignCanvas', () => ({
  DesignCanvas: () => <canvas aria-label="Composition canvas" />,
}));
vi.mock('./DesignPhotoWorkspace', () => ({
  DesignPhotoWorkspace: () => <section>Embedded photo workspace</section>,
}));
vi.mock('./DesignTopBar', () => ({ DesignTopBar: () => null }));
vi.mock('./DesignOptionsBar', () => ({ DesignOptionsBar: () => null }));
vi.mock('./DesignToolRails', () => ({ DesignToolRails: () => null }));
vi.mock('./DesignStatusBar', () => ({ DesignStatusBar: () => null }));
vi.mock('./preview3d/DesignSidePanel', () => ({
  DesignSidePanel: (props: DesignPhotoActions) => <DesignProjectPhotoList {...props} />,
}));

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
const openEditor = vi.fn();
const closeEditor = vi.fn();
const originalActions = {
  openEditor: useImageEditorStore.getState().openEditor,
  closeEditor: useImageEditorStore.getState().closeEditor,
};
beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  const project = createProject();
  useStore.setState({ project: { ...project, scene: { ...project.scene, objects: [photo] } } });
  useImageEditorStore.setState({ openEditor, closeEditor });
  studio.setState({ session: null, stash: null });
  studio.getState().openStudio();
  studio.getState().setView({ panXmm: 12, panYmm: 34, pxPerMm: 3 });
  studio
    .getState()
    .drawEntity({ kind: 'line', id: 'drawing', start: { x: 20, y: 20 }, end: { x: 60, y: 60 } });
});
afterEach(() => useImageEditorStore.setState(originalActions));

it('opens the current project photo and returns to the same composition, sketch and view', async () => {
  const host = await mountControl(<DesignStudioOverlay />);
  const before = studio.getState().session!;
  expect(before.surface3d).toBe(false);
  await clickControl(host, 'Select photo photo.png');
  await clickControl(host, 'Edit selected photo');
  expect(openEditor).toHaveBeenCalledWith(photo);
  expect(host.textContent).toContain('Embedded photo workspace');
  await clickControl(host, 'Back to canvas');
  expect(closeEditor).toHaveBeenCalledOnce();
  expect(host.querySelector('canvas')).not.toBeNull();
  expect(studio.getState().session?.view).toBe(before.view);
  expect(studio.getState().session?.history).toBe(before.history);

  // Applying a photo replaces the scene object. The next edit must open that current owner.
  const updated = { ...photo, pixelWidth: 50 };
  await act(async () => {
    const project = useStore.getState().project;
    useStore.setState({ project: { ...project, scene: { ...project.scene, objects: [updated] } } });
  });
  await clickControl(host, 'Edit selected photo');
  expect(openEditor).toHaveBeenLastCalledWith(updated);
});
it('disables hidden or locked photos instead of bypassing scene state through the list', async () => {
  const project = useStore.getState().project;
  useStore.setState({
    project: { ...project, scene: { ...project.scene, objects: [{ ...photo, locked: true }] } },
  });
  const host = await mountControl(<DesignStudioOverlay />);
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Select photo photo.png"]')!;
  expect(button.disabled).toBe(true);
  await act(async () => button.click());
  expect(openEditor).not.toHaveBeenCalled();
});
