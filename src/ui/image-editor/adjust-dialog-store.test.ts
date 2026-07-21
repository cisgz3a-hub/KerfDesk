import { beforeEach, describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { refreshAdjustPreview, useAdjustDialogStore } from './adjust-dialog-store';
import { createSession } from './editor-session';
import { useImageEditorStore } from './image-editor-store';

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

function seedSession(objectId = 'obj-1'): void {
  useImageEditorStore.setState({
    session: createSession(objectId, 'test.png', createRgbaBuffer(4, 4), BOUNDS),
    transform: null,
  });
}

beforeEach(() => {
  useAdjustDialogStore.setState({ dialog: null });
  useImageEditorStore.setState({ session: null, transform: null });
});

describe('useAdjustDialogStore', () => {
  it('open seeds defaults with preview enabled', () => {
    seedSession();
    useAdjustDialogStore.getState().open('levels');
    const dialog = useAdjustDialogStore.getState().dialog;
    expect(dialog?.id).toBe('levels');
    expect(dialog?.previewEnabled).toBe(true);
    expect(dialog?.params['gamma']).toBe(1);
  });

  it('parameterless entries commit instantly without opening', () => {
    seedSession();
    useAdjustDialogStore.getState().open('invert');
    expect(useAdjustDialogStore.getState().dialog).toBeNull();
    const session = useImageEditorStore.getState().session;
    expect(session?.doc.data[0]).toBe(0);
    expect(session?.history.undoStack.length).toBe(1);
  });

  it('commit applies the params once and closes', () => {
    seedSession();
    const store = useAdjustDialogStore.getState();
    store.open('brightness-contrast');
    store.setParams({ brightness: -100 });
    useAdjustDialogStore.getState().commit();
    expect(useAdjustDialogStore.getState().dialog).toBeNull();
    const session = useImageEditorStore.getState().session;
    expect(session?.doc.data[0]).toBe(127); // 255 - 128 brightness offset
    expect(session?.history.undoStack.length).toBe(1);
  });

  it('cancel discards without touching the document', () => {
    seedSession();
    useAdjustDialogStore.getState().open('threshold');
    useAdjustDialogStore.getState().cancel();
    expect(useAdjustDialogStore.getState().dialog).toBeNull();
    expect(useImageEditorStore.getState().session?.doc.data[0]).toBe(255);
  });

  it('refreshAdjustPreview fills previewDoc without mutating the session', () => {
    seedSession();
    useAdjustDialogStore.getState().open('threshold');
    refreshAdjustPreview();
    const dialog = useAdjustDialogStore.getState().dialog;
    expect(dialog?.previewDoc?.data[0]).toBe(255); // white stays white at 128
    expect(useImageEditorStore.getState().session?.doc.data[0]).toBe(255);
  });

  it('a session change invalidates the open dialog', () => {
    seedSession('obj-1');
    useAdjustDialogStore.getState().open('levels');
    expect(useAdjustDialogStore.getState().dialog).not.toBeNull();
    seedSession('obj-2');
    expect(useAdjustDialogStore.getState().dialog).toBeNull();
  });

  it('open is a no-op without a session or during a transform', () => {
    useAdjustDialogStore.getState().open('levels');
    expect(useAdjustDialogStore.getState().dialog).toBeNull();
  });

  it('curves opens its point editor instead of committing instantly', () => {
    seedSession();
    useAdjustDialogStore.getState().open('curves');
    const dialog = useAdjustDialogStore.getState().dialog;
    expect(dialog?.id).toBe('curves');
    expect(dialog?.curvePoints).toEqual([
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ]);
    expect(useImageEditorStore.getState().session?.history.undoStack.length).toBe(0);
  });

  it('commits the edited curve as one history entry', () => {
    seedSession();
    useAdjustDialogStore.getState().open('curves');
    useAdjustDialogStore.getState().setCurvePoints([
      { x: 0, y: 0 },
      { x: 255, y: 128 },
    ]);
    useAdjustDialogStore.getState().commit();
    const session = useImageEditorStore.getState().session;
    expect(session?.doc.data[0]).toBe(128); // white pulled down to the new ceiling
    expect(session?.history.undoStack.length).toBe(1);
  });
});
