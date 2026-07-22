import { beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_AFFINE } from '../../core/image-edit';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { createSession } from './editor-session';
import { useImageEditorStore } from './image-editor-store';
import { useTextDialogStore } from './text-dialog-store';

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

function seedSession(): void {
  useImageEditorStore.setState({
    session: createSession('R1', 'source.png', createRgbaBuffer(16, 16), BOUNDS),
    transform: null,
  });
}

beforeEach(() => {
  useTextDialogStore.setState({ isOpen: false, text: '', sizePx: 48 });
  useImageEditorStore.setState({ session: null, transform: null });
});

describe('useTextDialogStore', () => {
  it('commits an active transform before opening', () => {
    seedSession();
    useImageEditorStore.getState().startTransform();
    useImageEditorStore.getState().updateTransformAffine({
      ...IDENTITY_AFFINE,
      translateX: 1,
    });

    useTextDialogStore.getState().open();

    expect(useTextDialogStore.getState().isOpen).toBe(true);
    expect(useImageEditorStore.getState().transform).toBeNull();
    expect(useImageEditorStore.getState().session?.history.undoStack.at(-1)?.label).toBe(
      'Free transform',
    );
  });

  it('accepts positive fractional and document-scale sizes without a fixed cap', () => {
    useTextDialogStore.getState().setSizePx(1024.5);
    expect(useTextDialogStore.getState().sizePx).toBe(1024.5);
  });

  it('keeps the last valid size for non-positive or non-finite input', () => {
    useTextDialogStore.getState().setSizePx(24.25);
    useTextDialogStore.getState().setSizePx(0);
    useTextDialogStore.getState().setSizePx(Number.NaN);
    expect(useTextDialogStore.getState().sizePx).toBe(24.25);
  });
});
