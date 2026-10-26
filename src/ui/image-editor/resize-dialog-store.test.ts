import { beforeEach, describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import type { RasterImage } from '../../core/scene';
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
  useImageEditorStore.setState({ session: null, sessionOwner: null, transform: null });
});

describe('useResizeDialogStore', () => {
  it('open seeds the current dimensions and aspect', () => {
    seedSession();
    useResizeDialogStore.getState().open('image-size');
    const dialog = useResizeDialogStore.getState().dialog;
    expect(dialog?.width).toBe(80);
    expect(dialog?.height).toBe(40);
    expect(dialog?.widthDraft).toBe('80');
    expect(dialog?.heightDraft).toBe('40');
    expect(dialog?.aspect).toBe(2);
  });

  it('the aspect lock follows width edits for Image Size', () => {
    seedSession();
    useResizeDialogStore.getState().open('image-size');
    useResizeDialogStore.getState().setWidthDraft('160');
    expect(useResizeDialogStore.getState().dialog?.height).toBe(80);
    expect(useResizeDialogStore.getState().dialog?.heightDraft).toBe('80');
    useResizeDialogStore.getState().setLockAspect(false);
    useResizeDialogStore.getState().setHeightDraft('50');
    expect(useResizeDialogStore.getState().dialog?.width).toBe(160);
  });

  it('canvas-size edits never couple the axes', () => {
    seedSession();
    useResizeDialogStore.getState().open('canvas-size');
    useResizeDialogStore.getState().setWidthDraft('200');
    expect(useResizeDialogStore.getState().dialog?.height).toBe(40);
  });

  it('shows the exact capped and floored dimensions that commit will use', () => {
    seedSession();
    useResizeDialogStore.getState().open('image-size');

    useResizeDialogStore.getState().setWidthDraft('9000');
    expect(useResizeDialogStore.getState().dialog).toMatchObject({
      width: 8192,
      height: 4096,
      widthDraft: '8192',
      heightDraft: '4096',
    });

    useResizeDialogStore.getState().setHeightDraft('40.9');
    expect(useResizeDialogStore.getState().dialog).toMatchObject({
      width: 80,
      height: 40,
      widthDraft: '80',
      heightDraft: '40',
    });
  });

  it.each([
    [16, 12, 'width', 8192, 6144],
    [16, 12, 'height', 8192, 6144],
    [12, 16, 'width', 6144, 8192],
    [12, 16, 'height', 6144, 8192],
  ] as const)(
    'preserves the %i:%i aspect ratio when %s reaches the edge cap',
    (width, height, editedAxis, expectedWidth, expectedHeight) => {
      useImageEditorStore.setState({
        session: createSession('aspect', 'test.png', createRgbaBuffer(width, height), BOUNDS),
      });
      useResizeDialogStore.getState().open('image-size');
      if (editedAxis === 'width') useResizeDialogStore.getState().setWidthDraft('9000');
      else useResizeDialogStore.getState().setHeightDraft('9000');

      expect(useResizeDialogStore.getState().dialog).toMatchObject({
        lockAspect: true,
        width: expectedWidth,
        height: expectedHeight,
        widthDraft: String(expectedWidth),
        heightDraft: String(expectedHeight),
      });
    },
  );

  it.each(['image-size', 'canvas-size'] as const)(
    'discards the old crop coordinates after a committed %s and permits a fresh crop',
    (kind) => {
      seedSession();
      useImageEditorStore.setState({ pendingCrop: { x: 20, y: 10, width: 40, height: 20 } });
      useResizeDialogStore.getState().open(kind);
      useResizeDialogStore.getState().setWidthDraft('40');
      useResizeDialogStore.getState().commit();

      expect(useImageEditorStore.getState().pendingCrop).toBeNull();
      const resized = useImageEditorStore.getState().session;
      useImageEditorStore.getState().commitPendingCrop();
      expect(useImageEditorStore.getState().session).toBe(resized);

      useImageEditorStore.getState().setPendingCrop({ x: 1, y: 2, width: 8, height: 6 });
      useImageEditorStore.getState().commitPendingCrop();
      expect(useImageEditorStore.getState().session?.doc).toMatchObject({ width: 8, height: 6 });
      expect(useImageEditorStore.getState().session?.history.undoStack).toHaveLength(2);
    },
  );

  it('retains a pending crop when a resize is cancelled or leaves the dimensions unchanged', () => {
    seedSession();
    const crop = { x: 20, y: 10, width: 40, height: 20 };
    useImageEditorStore.setState({ pendingCrop: crop });
    useResizeDialogStore.getState().open('image-size');
    useResizeDialogStore.getState().setWidthDraft('40');
    useResizeDialogStore.getState().cancel();
    expect(useImageEditorStore.getState().pendingCrop).toBe(crop);

    useResizeDialogStore.getState().open('image-size');
    useResizeDialogStore.getState().commit();
    expect(useImageEditorStore.getState().pendingCrop).toBe(crop);
  });

  it('commit resamples the session, clears the view for a re-fit, and closes', () => {
    seedSession();
    useResizeDialogStore.getState().open('image-size');
    useResizeDialogStore.getState().setWidthDraft('160');
    useResizeDialogStore.getState().commit();
    expect(useResizeDialogStore.getState().dialog).toBeNull();
    const state = useImageEditorStore.getState();
    expect(state.session?.doc.width).toBe(160);
    expect(state.session?.doc.height).toBe(80);
    expect(state.view).toBeNull();
  });

  it.each(['', '0', '-2', 'not-a-number'])(
    'keeps invalid width draft %j out of the candidate and closes with the last valid size',
    (draft) => {
      seedSession();
      const session = useImageEditorStore.getState().session;
      useResizeDialogStore.getState().open('image-size');

      useResizeDialogStore.getState().setWidthDraft(draft);
      expect(useResizeDialogStore.getState().dialog).toMatchObject({
        width: 80,
        height: 40,
        widthDraft: draft,
      });
      useResizeDialogStore.getState().commit();

      expect(useImageEditorStore.getState().session).toBe(session);
      expect(useResizeDialogStore.getState().dialog).toBeNull();
    },
  );

  it('restores the exact valid dimensions when invalid drafts blur', () => {
    seedSession();
    useResizeDialogStore.getState().open('canvas-size');
    useResizeDialogStore.getState().setWidthDraft('200');
    useResizeDialogStore.getState().setWidthDraft('');
    useResizeDialogStore.getState().setHeightDraft('-1');

    useResizeDialogStore.getState().reconcileWidthDraft();
    useResizeDialogStore.getState().reconcileHeightDraft();

    expect(useResizeDialogStore.getState().dialog).toMatchObject({
      width: 200,
      height: 40,
      widthDraft: '200',
      heightDraft: '40',
    });
  });

  it('a session change invalidates the open dialog', () => {
    seedSession('obj-1');
    useResizeDialogStore.getState().open('canvas-size');
    expect(useResizeDialogStore.getState().dialog).not.toBeNull();
    seedSession('obj-2');
    expect(useResizeDialogStore.getState().dialog).toBeNull();
  });

  it('does not apply an old draft to a same-id replacement session', () => {
    seedSession('obj-1');
    useResizeDialogStore.getState().open('canvas-size');
    useResizeDialogStore.getState().setWidthDraft('200');

    const replacement = createSession('obj-1', 'replacement.png', createRgbaBuffer(20, 10), BOUNDS);
    useImageEditorStore.setState({ session: replacement, sessionOwner: null });

    expect(useResizeDialogStore.getState().dialog).toBeNull();
    useResizeDialogStore.getState().commit();
    expect(useImageEditorStore.getState().session).toBe(replacement);
  });

  it('invalidates an old draft when the exact source owner changes', () => {
    const session = createSession('obj-1', 'source.png', createRgbaBuffer(80, 40), BOUNDS);
    const firstOwner = {
      projectDocumentEpoch: 1,
      sourceImage: { id: 'obj-1', kind: 'raster-image' } as RasterImage,
    };
    useImageEditorStore.setState({ session, sessionOwner: firstOwner, transform: null });
    useResizeDialogStore.getState().open('image-size');

    useImageEditorStore.setState({
      session,
      sessionOwner: {
        projectDocumentEpoch: 2,
        sourceImage: { id: 'obj-1', kind: 'raster-image' } as RasterImage,
      },
    });

    expect(useResizeDialogStore.getState().dialog).toBeNull();
    expect(useImageEditorStore.getState().session).toBe(session);
  });
});
