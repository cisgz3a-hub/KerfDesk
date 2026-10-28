// L5-P3-5 (rolling audit v7): a pointer the system cancels (palm rejection, a
// system gesture) sends no pointerup. The move stayed open, a later hover kept
// dragging, and Undo could not reach the starting place.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DesignSurface } from './design-surface';
import { useDesignPointer } from './use-design-pointer';
import { useDesignStudioStore } from './design-studio-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const surface: DesignSurface = {
  toMm: (event) => ({ x: event.clientX, y: event.clientY }),
  pxPerMm: () => 1,
  toClient: (point) => point,
};

function PointerHarness(): JSX.Element {
  const pointer = useDesignPointer(surface, () => 'entity');
  return (
    <canvas
      onPointerDown={pointer.onPointerDown}
      onPointerMove={pointer.onPointerMove}
      onPointerUp={pointer.onPointerUp}
      onPointerCancel={pointer.onPointerCancel}
      onLostPointerCapture={pointer.onLostPointerCapture}
    />
  );
}

function move(canvas: HTMLCanvasElement, x: number, y: number): void {
  canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
}

describe('a cancelled Design Studio pointer gesture', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    useDesignStudioStore.setState({ session: null, stash: null });
    void useDesignStudioStore.getState().openStudio();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useDesignStudioStore.setState({ session: null, stash: null });
  });

  it('ends a move the system cancels as one Undo step', () => {
    useDesignStudioStore.getState().setSketch({
      entities: [{ id: 'bar', kind: 'line', start: { x: 0, y: 0 }, end: { x: 40, y: 0 } }],
    });
    useDesignStudioStore.getState().setSelection(['bar']);
    const before = useDesignStudioStore.getState().session!.history.present;
    act(() => root.render(<PointerHarness />));
    const canvas = host.querySelector('canvas');
    if (canvas === null) throw new Error('expected a canvas');

    act(() => {
      canvas.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 0 }),
      );
      move(canvas, 40, 0);
      canvas.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
      move(canvas, 70, 0);
    });

    const session = useDesignStudioStore.getState().session!;
    expect(session.move).toBeNull();
    expect(session.history.present.entities[0]).toMatchObject({
      start: { x: 20, y: 0 },
      end: { x: 60, y: 0 },
    });
    useDesignStudioStore.getState().undo();
    expect(useDesignStudioStore.getState().session!.history.present).toEqual(before);
  });

  it('drops a draft the system cancels instead of drawing it', () => {
    useDesignStudioStore.getState().setTool('line');
    act(() => root.render(<PointerHarness />));
    const canvas = host.querySelector('canvas');
    if (canvas === null) throw new Error('expected a canvas');

    act(() => {
      canvas.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }),
      );
      move(canvas, 50, 10);
      canvas.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
    });

    const session = useDesignStudioStore.getState().session!;
    expect(session.draft).toBeNull();
    expect(session.history.present.entities).toEqual([]);
  });
});
