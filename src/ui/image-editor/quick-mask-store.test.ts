import { beforeEach, describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { rectSelection } from '../../core/image-select/marquee';
import { createSession, withSelection } from './editor-session';
import { useImageEditorStore } from './image-editor-store';
import { useQuickMaskStore } from './quick-mask-store';

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

function seedSession(objectId = 'obj-1', withRect = false): void {
  let session = createSession(objectId, 'test.png', createRgbaBuffer(16, 16), BOUNDS);
  if (withRect) {
    session = withSelection(session, rectSelection(16, 16, { x: 0, y: 0, width: 4, height: 16 }));
  }
  useImageEditorStore.setState({ session, transform: null, tool: { kind: 'brush' } });
}

beforeEach(() => {
  useQuickMaskStore.setState({ rubylith: null, revision: 0 });
  useImageEditorStore.setState({ session: null, transform: null });
});

describe('useQuickMaskStore', () => {
  it('enter seeds the rubylith from the selection and clears the ants', () => {
    seedSession('obj-1', true);
    useQuickMaskStore.getState().toggle();
    const rubylith = useQuickMaskStore.getState().rubylith;
    expect(rubylith).not.toBeNull();
    expect(rubylith?.data[0]).toBe(0); // selected column = black ink
    expect(rubylith?.data[8 * 4]).toBe(255); // unselected = white
    expect(useImageEditorStore.getState().session?.selection).toBeNull();
  });

  it('painting ink and toggling out produces the selection', () => {
    seedSession();
    const store = useQuickMaskStore.getState();
    store.toggle();
    const consumed = useQuickMaskStore.getState().strokeInto([{ x: 8, y: 8 }]);
    expect(consumed).toBe(true);
    useQuickMaskStore.getState().toggle();
    const selection = useImageEditorStore.getState().session?.selection;
    expect(selection).not.toBeNull();
    expect(selection?.alpha[8 * 16 + 8] ?? 0).toBeGreaterThan(0);
    expect(selection?.alpha[0]).toBe(0);
    expect(useQuickMaskStore.getState().rubylith).toBeNull();
  });

  it('an empty rubylith converts to no selection', () => {
    seedSession();
    useQuickMaskStore.getState().toggle();
    useQuickMaskStore.getState().toggle();
    expect(useImageEditorStore.getState().session?.selection).toBeNull();
  });

  it('strokeInto is a no-op pass-through when the mode is off', () => {
    seedSession();
    expect(useQuickMaskStore.getState().strokeInto([{ x: 1, y: 1 }])).toBe(false);
  });

  it('Ctrl+Z inside the mode undoes rubylith strokes (A2)', () => {
    seedSession();
    useQuickMaskStore.getState().toggle();
    useQuickMaskStore.getState().strokeInto([{ x: 8, y: 8 }]);
    const inked = useQuickMaskStore.getState().rubylith?.data[(8 * 16 + 8) * 4] ?? 255;
    expect(inked).toBeLessThan(255);
    expect(useQuickMaskStore.getState().undoStroke()).toBe(true);
    expect(useQuickMaskStore.getState().rubylith?.data[(8 * 16 + 8) * 4]).toBe(255);
    expect(useQuickMaskStore.getState().redoStroke()).toBe(true);
    expect(useQuickMaskStore.getState().rubylith?.data[(8 * 16 + 8) * 4]).toBe(inked);
  });

  it('undoStroke passes through (false) when the mode is off', () => {
    seedSession();
    expect(useQuickMaskStore.getState().undoStroke()).toBe(false);
  });

  it('a session change drops the mode', () => {
    seedSession('obj-1');
    useQuickMaskStore.getState().toggle();
    expect(useQuickMaskStore.getState().rubylith).not.toBeNull();
    seedSession('obj-2');
    expect(useQuickMaskStore.getState().rubylith).toBeNull();
  });
});
