import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('applyAndTrace', () => {
  it('opens trace and closes the editor when there are no pending edits', async () => {
    useImageEditorStore.setState({ session: cleanSession() });
    const onApplied = vi.fn();
    useImageEditorStore.getState().applyAndTrace(onApplied);
    await Promise.resolve();
    expect(onApplied).toHaveBeenCalledOnce();
    expect(onApplied).toHaveBeenCalledWith('R1');
    expect(useImageEditorStore.getState().session).toBeNull();
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

  it('is a no-op while an apply is already running', () => {
    useImageEditorStore.setState({ session: cleanSession(), isApplying: true });
    const onApplied = vi.fn();
    useImageEditorStore.getState().applyAndTrace(onApplied);
    expect(onApplied).not.toHaveBeenCalled();
    expect(useImageEditorStore.getState().session).not.toBeNull();
  });
});
