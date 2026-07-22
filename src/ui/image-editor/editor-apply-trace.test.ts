import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { createSession } from './editor-session';
import { useImageEditorStore } from './image-editor-store';

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

function cleanSession() {
  // createSession starts with dirtySinceApply = false.
  return createSession('R1', 'source.png', createRgbaBuffer(4, 4), BOUNDS);
}

beforeEach(() => {
  useImageEditorStore.setState({ session: null, isApplying: false });
});

describe('applyAndTrace', () => {
  it('does nothing and keeps the editor open when there are no pending edits', async () => {
    useImageEditorStore.setState({ session: cleanSession() });
    const onApplied = vi.fn();
    useImageEditorStore.getState().applyAndTrace(onApplied);
    await Promise.resolve();
    await Promise.resolve();
    expect(onApplied).not.toHaveBeenCalled();
    // A clean session is never closed by Apply & Trace.
    expect(useImageEditorStore.getState().session).not.toBeNull();
  });

  it('begins applying (guard passes) for a dirty session', () => {
    useImageEditorStore.setState({ session: { ...cleanSession(), dirtySinceApply: true } });
    useImageEditorStore.getState().applyAndTrace(vi.fn());
    // The bake started — isApplying latched even though the canvas bake
    // resolves asynchronously (its completion is verified live).
    expect(useImageEditorStore.getState().isApplying).toBe(true);
  });

  it('is a no-op with no session', () => {
    const onApplied = vi.fn();
    useImageEditorStore.getState().applyAndTrace(onApplied);
    expect(useImageEditorStore.getState().isApplying).toBe(false);
    expect(onApplied).not.toHaveBeenCalled();
  });
});
