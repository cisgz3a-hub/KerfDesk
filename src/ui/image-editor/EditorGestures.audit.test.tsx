import { act, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { EditorCanvas } from './EditorCanvas';
import { CurvesEditor } from './CurvesEditor';
import { ColorPickerPad } from './ColorPickerPad';
import { createSession } from './editor-session';
import { useImageEditorStore as editor } from './image-editor-store';
import { useAdjustDialogStore as adjust } from './adjust-dialog-store';
import { mountControl } from './control-audit-test-support';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  editor.setState({
    session: createSession('gesture-audit', 'audit.png', createRgbaBuffer(16, 16), {
      minX: 0,
      minY: 0,
      maxX: 16,
      maxY: 16,
    }),
    sessionOwner: null,
    transform: null,
    pendingCrop: null,
    view: { scale: 1, panX: 0, panY: 0 },
    tool: { kind: 'pencil' },
    foreground: { r: 0, g: 0, b: 0 },
    isSpacePanning: false,
  });
  adjust.setState({ dialog: null });
});
afterEach(() => vi.unstubAllGlobals());

async function pointer(target: Element, kind: string, x: number, y: number): Promise<void> {
  await act(async () =>
    target.dispatchEvent(
      new MouseEvent(kind, { bubbles: true, clientX: x, clientY: y, buttons: 1 }),
    ),
  );
}

it('document canvas draws one undoable pencil stroke, cancels an unfinished stroke, and zooms without changing pixels', async () => {
  const session = editor.getState().session!;
  const host = await mountControl(<EditorCanvas composite={session.doc} />);
  const canvas = host.querySelector('canvas')!;
  await pointer(canvas, 'pointerdown', 2, 2);
  await pointer(canvas, 'pointermove', 6, 2);
  await pointer(canvas, 'pointerup', 6, 2);
  expect(editor.getState().session?.history.undoStack).toHaveLength(1);
  expect(editor.getState().session?.doc.data[(2 * 16 + 4) * 4]).toBe(0);
  const pixels = new Uint8ClampedArray(editor.getState().session!.doc.data);
  await pointer(canvas, 'pointerdown', 2, 8);
  await pointer(canvas, 'pointermove', 6, 8);
  await pointer(canvas, 'pointercancel', 6, 8);
  expect(editor.getState().session?.history.undoStack).toHaveLength(1);
  await act(async () =>
    canvas.dispatchEvent(
      new WheelEvent('wheel', { bubbles: true, deltaY: -1, clientX: 4, clientY: 4 }),
    ),
  );
  expect(editor.getState().view?.scale).toBeGreaterThan(1);
  expect(editor.getState().session?.doc.data).toEqual(pixels);
});

it('curve canvas adds, drags and removes a control point without committing document pixels', async () => {
  adjust.getState().open('curves');
  const session = editor.getState().session!;
  function Harness() {
    const points = adjust((state) => state.dialog?.curvePoints ?? []);
    return <CurvesEditor points={points} session={session} />;
  }
  const host = await mountControl(<Harness />);
  const canvas = host.querySelector('canvas')!;
  canvas.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 272,
    height: 272,
    right: 272,
    bottom: 272,
    toJSON: () => ({}),
  });
  await pointer(canvas, 'pointerdown', 136, 135);
  expect(adjust.getState().dialog?.curvePoints).toContainEqual({ x: 128, y: 128 });
  await pointer(canvas, 'pointermove', 150, 105);
  expect(adjust.getState().dialog?.curvePoints).toContainEqual({ x: 142, y: 158 });
  await pointer(canvas, 'pointermove', 150, -50);
  expect(adjust.getState().dialog?.curvePoints).toEqual([
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ]);
  await pointer(canvas, 'pointerup', 150, -50);
  expect(editor.getState().session).toBe(session);
});

it('colour pad maps pointer coordinates to saturation and brightness and clamps an outside drag', async () => {
  function Harness() {
    const [hsv, setHsv] = useState({ h: 0, s: 0, v: 1 });
    return <ColorPickerPad hsv={hsv} onChange={setHsv} />;
  }
  const host = await mountControl(<Harness />);
  const pad = host.querySelector<HTMLElement>('[role="slider"]')!;
  pad.setPointerCapture = vi.fn();
  pad.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    right: 100,
    bottom: 100,
    toJSON: () => ({}),
  });
  await pointer(pad, 'pointerdown', 25, 75);
  expect(pad.getAttribute('aria-valuetext')).toBe('saturation 25%, brightness 25%');
  await pointer(pad, 'pointermove', 200, -50);
  expect(pad.getAttribute('aria-valuetext')).toBe('saturation 100%, brightness 100%');
});
