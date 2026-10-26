import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { EditorCanvas } from './EditorCanvas';
import { useAdjustDialogStore } from './adjust-dialog-store';
import { mountControl } from './control-audit-test-support';
import { createSession } from './editor-session';
import {
  addLayerAboveActive,
  compositeSession,
  setActiveLayerProps,
} from './editor-session-layers';
import { handleEditorKeyDown } from './editor-shortcuts';
import { useImageEditorStore as editor } from './image-editor-store';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  editor.setState({
    session: createSession('audit-repairs', 'audit.png', createRgbaBuffer(16, 12), {
      minX: 0,
      minY: 0,
      maxX: 16,
      maxY: 12,
    }),
    sessionOwner: null,
    transform: null,
    pendingCrop: null,
    view: { scale: 1, panX: 0, panY: 0 },
    tool: { kind: 'brush' },
    brush: { diameterPx: 1, hardness: 1, opacity: 1 },
    foreground: { r: 0, g: 0, b: 0 },
    isSpacePanning: false,
  });
  useAdjustDialogStore.setState({ dialog: null });
});

afterEach(() => vi.unstubAllGlobals());

function Harness(): JSX.Element {
  const session = editor((state) => state.session);
  return (
    <div onKeyDown={handleEditorKeyDown}>
      <EditorCanvas composite={session === null ? undefined : compositeSession(session)} />
    </div>
  );
}

function pointer(
  canvas: HTMLCanvasElement,
  kind: string,
  x: number,
  y: number,
  altKey = false,
): void {
  canvas.dispatchEvent(
    new MouseEvent(kind, { bubbles: true, clientX: x, clientY: y, buttons: 1, altKey }),
  );
}

function key(canvas: HTMLCanvasElement, value: string): void {
  canvas.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value }));
}

it.each(['crop', 'pencil'] as const)(
  'Escape retires a held %s gesture before pointer-up and Enter can run in the same event turn',
  async (kind) => {
    editor.getState().setTool({ kind });
    const session = editor.getState().session!;
    const pixels = session.doc.data.slice();
    const host = await mountControl(<Harness />);
    const canvas = host.querySelector('canvas')!;
    await act(async () => {
      pointer(canvas, 'pointerdown', 2, 2);
      pointer(canvas, 'pointermove', 10, 10);
      key(canvas, 'Escape');
      pointer(canvas, 'pointermove', 11, 10);
      pointer(canvas, 'pointerup', 11, 10);
      key(canvas, 'Enter');
    });

    expect(editor.getState().tool.kind).toBe('brush');
    expect(editor.getState().pendingCrop).toBeNull();
    expect(editor.getState().session).toBe(session);
    expect(editor.getState().session?.doc.data).toEqual(pixels);
    expect(editor.getState().session?.history.undoStack).toHaveLength(0);

    await act(async () => {
      pointer(canvas, 'pointerdown', 2.5, 6.5);
      pointer(canvas, 'pointermove', 8.5, 6.5);
      pointer(canvas, 'pointerup', 8.5, 6.5);
    });
    expect(editor.getState().session?.history.undoStack).toHaveLength(1);
    expect(editor.getState().session?.doc.data).not.toEqual(pixels);
  },
);

it('cancels a replacement held crop when Escape discards the preceding crop draft', async () => {
  editor.getState().setTool({ kind: 'crop' });
  editor.getState().setPendingCrop({ x: 1, y: 1, width: 4, height: 4 });
  const session = editor.getState().session;
  const host = await mountControl(<Harness />);
  const canvas = host.querySelector('canvas')!;
  await act(async () => {
    pointer(canvas, 'pointerdown', 2, 2);
    pointer(canvas, 'pointermove', 10, 10);
    key(canvas, 'Escape');
    pointer(canvas, 'pointerup', 10, 10);
    key(canvas, 'Enter');
  });
  expect(editor.getState().pendingCrop).toBeNull();
  expect(editor.getState().session).toBe(session);
  expect(editor.getState().session?.history.undoStack).toHaveLength(0);
});

it('keeps a held stroke from crossing to a replacement image session', async () => {
  editor.getState().setTool({ kind: 'pencil' });
  const host = await mountControl(<Harness />);
  const canvas = host.querySelector('canvas')!;
  const replacement = createSession('replacement', 'replacement.png', createRgbaBuffer(16, 12), {
    minX: 0,
    minY: 0,
    maxX: 16,
    maxY: 12,
  });
  await act(async () => {
    pointer(canvas, 'pointerdown', 2, 2);
    pointer(canvas, 'pointermove', 10, 10);
    editor.setState({ session: replacement });
    pointer(canvas, 'pointerup', 10, 10);
  });
  expect(editor.getState().session).toBe(replacement);
  expect(replacement.history.undoStack).toHaveLength(0);
  expect(replacement.dirtySinceApply).toBe(false);
});

it('reports the visible composite through transparent, hidden and translucent active layers', async () => {
  const session = editor.getState().session!;
  session.doc.data.fill(238);
  for (let index = 3; index < session.doc.data.length; index += 4) session.doc.data[index] = 255;
  const layered = addLayerAboveActive(session, 'transparent');
  editor.setState({ session: layered });
  const host = await mountControl(<Harness />);
  const canvas = host.querySelector('canvas')!;
  await act(async () => pointer(canvas, 'pointermove', 3, 3));
  expect(host.textContent).toContain('RGB 238,238,238 · K 7%');
  await act(async () => pointer(canvas, 'pointerdown', 3, 3, true));
  expect(editor.getState().foreground).toEqual({ r: 238, g: 238, b: 238 });

  layered.doc.data.fill(0);
  for (let index = 3; index < layered.doc.data.length; index += 4) layered.doc.data[index] = 255;
  await act(async () =>
    editor.setState({ session: setActiveLayerProps(layered, { isVisible: false }) }),
  );
  await act(async () => pointer(canvas, 'pointermove', 3, 3));
  expect(host.textContent).toContain('RGB 238,238,238 · K 7%');

  await act(async () =>
    editor.setState({
      session: setActiveLayerProps(editor.getState().session!, { isVisible: true, opacity: 0.5 }),
    }),
  );
  await act(async () => pointer(canvas, 'pointermove', 3, 3));
  expect(host.textContent).toContain('RGB 119,119,119 · K 53%');
});
