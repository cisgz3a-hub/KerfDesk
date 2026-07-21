import { beforeEach, describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { createSession } from './editor-session';
import { useImageEditorStore } from './image-editor-store';
import { useResizeDialogStore } from './resize-dialog-store';

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 5 };

function seedSession(objectId = 'obj-1'): void {
  useImageEditorStore.setState({
    session: createSession(objectId, 'test.png', createRgbaBuffer(80, 40), BOUNDS),
    transform: null,
    view: { scale: 1, panX: 0, panY: 0 },
  });
}

beforeEach(() => {
  useResizeDialogStore.setState({ dialog: null });
  useImageEditorStore.setState({ session: null, transform: null });
});

describe('useResizeDialogStore', () => {
  it('open seeds the current dimensions and aspect', () => {
    seedSession();
    useResizeDialogStore.getState().open('image-size');
    const dialog = useResizeDialogStore.getState().dialog;
    expect(dialog?.width).toBe(80);
    expect(dialog?.height).toBe(40);
    expect(dialog?.aspect).toBe(2);
  });

  it('the aspect lock follows width edits for Image Size', () => {
    seedSession();
    useResizeDialogStore.getState().open('image-size');
    useResizeDialogStore.getState().setWidth(160);
    expect(useResizeDialogStore.getState().dialog?.height).toBe(80);
    useResizeDialogStore.getState().setLockAspect(false);
    useResizeDialogStore.getState().setHeight(50);
    expect(useResizeDialogStore.getState().dialog?.width).toBe(160);
  });

  it('canvas-size edits never couple the axes', () => {
    seedSession();
    useResizeDialogStore.getState().open('canvas-size');
    useResizeDialogStore.getState().setWidth(200);
    expect(useResizeDialogStore.getState().dialog?.height).toBe(40);
  });

  it('commit resamples the session, clears the view for a re-fit, and closes', () => {
    seedSession();
    useResizeDialogStore.getState().open('image-size');
    useResizeDialogStore.getState().setWidth(160);
    useResizeDialogStore.getState().commit();
    expect(useResizeDialogStore.getState().dialog).toBeNull();
    const state = useImageEditorStore.getState();
    expect(state.session?.doc.width).toBe(160);
    expect(state.session?.doc.height).toBe(80);
    expect(state.view).toBeNull();
  });

  it('a session change invalidates the open dialog', () => {
    seedSession('obj-1');
    useResizeDialogStore.getState().open('canvas-size');
    expect(useResizeDialogStore.getState().dialog).not.toBeNull();
    seedSession('obj-2');
    expect(useResizeDialogStore.getState().dialog).toBeNull();
  });
});
