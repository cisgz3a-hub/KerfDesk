import { beforeEach, describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { useAdjustDialogStore } from './adjust-dialog-store';
import { createSession } from './editor-session';
import { useImageEditorStore } from './image-editor-store';
import { canvasDoubleClickAction } from './use-editor-pointer';

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

function seedSession(): void {
  useImageEditorStore.setState({
    session: createSession('obj-1', 'test.png', createRgbaBuffer(8, 8), BOUNDS),
    transform: null,
    pendingCrop: null,
  });
}

beforeEach(() => {
  useAdjustDialogStore.setState({ dialog: null });
  useImageEditorStore.setState({
    session: null,
    transform: null,
    pendingCrop: null,
    tool: { kind: 'brush' },
  });
});

describe('canvasDoubleClickAction', () => {
  it('returns a non-default tool (wand) to the Brush', () => {
    seedSession();
    useImageEditorStore.setState({ tool: { kind: 'wand' } });
    canvasDoubleClickAction();
    expect(useImageEditorStore.getState().tool.kind).toBe('brush');
  });

  it('is a no-op when the Brush is already active', () => {
    seedSession();
    canvasDoubleClickAction();
    expect(useImageEditorStore.getState().tool.kind).toBe('brush');
  });

  it('commits a pending crop instead of switching tools (Photoshop)', () => {
    seedSession();
    useImageEditorStore.setState({
      tool: { kind: 'crop' },
      pendingCrop: { x: 1, y: 1, width: 4, height: 4 },
    });
    canvasDoubleClickAction();
    const state = useImageEditorStore.getState();
    expect(state.pendingCrop).toBeNull();
    expect(state.session?.doc.width).toBe(4); // crop landed
    expect(state.tool.kind).toBe('crop'); // tool untouched by the commit
  });

  it('does nothing while an adjustment dialog is open', () => {
    seedSession();
    useImageEditorStore.setState({ tool: { kind: 'wand' } });
    useAdjustDialogStore.getState().open('levels');
    canvasDoubleClickAction();
    expect(useImageEditorStore.getState().tool.kind).toBe('wand');
  });
});
