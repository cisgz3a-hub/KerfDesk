import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDesignSession } from './design-session';
import type { DesignSurface } from './design-surface';
import { useDesignPointer } from './use-design-pointer';
import { useDesignStudioStore } from './design-studio-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const surface: DesignSurface = {
  toMm: (event) => ({ x: event.clientX, y: event.clientY }),
  pxPerMm: () => 1,
};

function PointerHarness(): JSX.Element {
  const pointer = useDesignPointer(surface, () => 'entity');
  return (
    <canvas
      onPointerDown={pointer.onPointerDown}
      onPointerMove={pointer.onPointerMove}
      onPointerUp={pointer.onPointerUp}
      onPointerLeave={pointer.onPointerLeave}
      onDoubleClick={pointer.onDoubleClick}
    />
  );
}

function click(canvas: HTMLCanvasElement, x: number, y: number): void {
  canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
  canvas.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: x, clientY: y }));
}

function move(canvas: HTMLCanvasElement, x: number, y: number): void {
  canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
}

function cameraButtonClick(canvas: HTMLCanvasElement, button: number): void {
  canvas.dispatchEvent(
    new MouseEvent('pointerdown', { bubbles: true, button, clientX: 40, clientY: 40 }),
  );
  canvas.dispatchEvent(
    new MouseEvent('pointerup', { bubbles: true, button, clientX: 80, clientY: 80 }),
  );
}

describe('Design point-tool pointer interactions', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    useDesignStudioStore.setState({ session: null, stash: null });
    useDesignStudioStore.getState().openStudio();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useDesignStudioStore.setState({ session: null, stash: null });
  });

  it('closes a Polyline by clicking its first point and records one undo step', () => {
    useDesignStudioStore.getState().addLayer('secondary');
    useDesignStudioStore.getState().setActiveLayer('secondary');
    useDesignStudioStore.getState().setTool('path');
    const layerId = useDesignStudioStore.getState().session?.activeLayerId;
    const historyDepth = useDesignStudioStore.getState().session?.history.past.length ?? 0;
    act(() => root.render(<PointerHarness />));
    const canvas = host.querySelector('canvas');
    if (canvas === null) throw new Error('expected a canvas');

    act(() => {
      click(canvas, 20, 20);
      click(canvas, 80, 20);
      click(canvas, 80, 80);
      click(canvas, 20, 20);
    });

    const session = useDesignStudioStore.getState().session;
    expect(session?.history.present.entities).toEqual([
      {
        kind: 'path',
        id: 'entity',
        points: [
          { x: 20, y: 20 },
          { x: 80, y: 20 },
          { x: 80, y: 80 },
        ],
        closed: true,
        layerId,
      },
    ]);
    expect(session?.history.past).toHaveLength(historyDepth + 1);

    act(() => useDesignStudioStore.getState().undo());
    expect(useDesignStudioStore.getState().session?.history.present.entities).toHaveLength(0);
    act(() => useDesignStudioStore.getState().redo());
    expect(useDesignStudioStore.getState().session?.history.present.entities).toHaveLength(1);
  });

  it('does not add Polyline or Arc points with middle or right camera buttons', () => {
    act(() => root.render(<PointerHarness />));
    const canvas = host.querySelector('canvas');
    if (canvas === null) throw new Error('expected a canvas');

    for (const tool of ['path', 'arc'] as const) {
      useDesignStudioStore.getState().setTool(tool);
      act(() => {
        cameraButtonClick(canvas, 1);
        cameraButtonClick(canvas, 2);
      });
      const session = useDesignStudioStore.getState().session;
      expect(session?.pointSequence).toBeNull();
      expect(session?.history.present.entities).toHaveLength(0);
      expect(session?.history.past).toHaveLength(0);
    }
  });

  it('finishes an open Polyline on double-click and returns to Select', () => {
    useDesignStudioStore.getState().setTool('path');
    act(() => root.render(<PointerHarness />));
    const canvas = host.querySelector('canvas');
    if (canvas === null) throw new Error('expected a canvas');

    act(() => {
      click(canvas, 20, 20);
      click(canvas, 80, 20);
      click(canvas, 80, 80);
      click(canvas, 80, 80);
      canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    const session = useDesignStudioStore.getState().session;
    expect(session?.history.present.entities).toEqual([
      {
        kind: 'path',
        id: 'entity',
        points: [
          { x: 20, y: 20 },
          { x: 80, y: 20 },
          { x: 80, y: 80 },
        ],
        closed: false,
        layerId: session?.activeLayerId,
      },
    ]);
    expect(session?.history.past).toHaveLength(1);
    expect(session?.selectedIds.size).toBe(0);
    expect(session?.tool).toBe('select');
  });

  it('treats a one-point double-click as cancel-and-exit', () => {
    useDesignStudioStore.getState().setTool('path');
    act(() => root.render(<PointerHarness />));
    const canvas = host.querySelector('canvas');
    if (canvas === null) throw new Error('expected a canvas');

    act(() => {
      click(canvas, 20, 20);
      click(canvas, 20, 20);
      canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    const session = useDesignStudioStore.getState().session;
    expect(session?.history.past).toHaveLength(0);
    expect(session?.pointSequence).toBeNull();
    expect(session?.tool).toBe('select');
  });

  it('drops a drifted second double-click point from an open Polyline', () => {
    useDesignStudioStore.getState().setTool('path');
    act(() => root.render(<PointerHarness />));
    const canvas = host.querySelector('canvas');
    if (canvas === null) throw new Error('expected a canvas');

    act(() => {
      click(canvas, 20, 20);
      click(canvas, 80, 20);
      click(canvas, 80, 80);
      click(canvas, 93, 82);
      canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    const entity = useDesignStudioStore.getState().session?.history.present.entities[0];
    expect(entity?.kind).toBe('path');
    if (entity?.kind !== 'path') throw new Error('expected a Polyline');
    expect(entity.points).toEqual([
      { x: 20, y: 20 },
      { x: 80, y: 20 },
      { x: 80, y: 80 },
    ]);
  });

  it('does not leave a new Polyline after double-clicking the start to close', () => {
    useDesignStudioStore.getState().setTool('path');
    act(() => root.render(<PointerHarness />));
    const canvas = host.querySelector('canvas');
    if (canvas === null) throw new Error('expected a canvas');

    act(() => {
      click(canvas, 20, 20);
      click(canvas, 80, 20);
      click(canvas, 80, 80);
      click(canvas, 20, 20);
      click(canvas, 20, 20);
      canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    const session = useDesignStudioStore.getState().session;
    expect(session?.history.present.entities).toHaveLength(1);
    expect(session?.history.present.entities[0]).toMatchObject({ kind: 'path', closed: true });
    expect(session?.pointSequence).toBeNull();
    expect(session?.tool).toBe('select');
  });

  it('lets an object snap beat Ortho for a later Polyline corner', () => {
    useDesignStudioStore.setState({
      session: createDesignSession({
        entities: [
          {
            kind: 'line',
            id: 'guide',
            start: { x: 73, y: 26 },
            end: { x: 100, y: 26 },
          },
        ],
      }),
      stash: null,
    });
    useDesignStudioStore.getState().toggleOrtho();
    useDesignStudioStore.getState().setTool('path');
    act(() => root.render(<PointerHarness />));
    const canvas = host.querySelector('canvas');
    if (canvas === null) throw new Error('expected a canvas');

    act(() => {
      click(canvas, 20, 20);
      click(canvas, 40, 23);
      click(canvas, 70, 25);
    });

    const sequence = useDesignStudioStore.getState().session?.pointSequence;
    expect(sequence?.kind).toBe('path');
    expect(sequence?.kind === 'path' ? sequence.points : null).toEqual([
      { x: 20, y: 20 },
      { x: 40, y: 20 },
      { x: 73, y: 26 },
    ]);
  });

  it('keeps a distinct object snap near the start instead of closing the Polyline', () => {
    useDesignStudioStore.setState({
      session: createDesignSession({
        entities: [
          {
            kind: 'line',
            id: 'guide',
            start: { x: 25, y: 20 },
            end: { x: 25, y: 60 },
          },
        ],
      }),
      stash: null,
    });
    useDesignStudioStore.getState().toggleSnap();
    useDesignStudioStore.getState().setTool('path');
    act(() => root.render(<PointerHarness />));
    const canvas = host.querySelector('canvas');
    if (canvas === null) throw new Error('expected a canvas');

    act(() => {
      click(canvas, 20, 20);
      click(canvas, 60, 20);
      click(canvas, 60, 60);
      useDesignStudioStore.getState().toggleSnap();
      click(canvas, 24, 20);
    });

    const session = useDesignStudioStore.getState().session;
    const sequence = session?.pointSequence;
    expect(session?.history.present.entities).toHaveLength(1);
    expect(session?.history.past).toHaveLength(0);
    expect(sequence?.kind).toBe('path');
    expect(sequence?.kind === 'path' ? sequence.points.at(-1) : null).toEqual({ x: 25, y: 20 });
  });

  it('creates an Arc from centre, start, and end as one active-layer undo step', () => {
    useDesignStudioStore.getState().addLayer('secondary');
    useDesignStudioStore.getState().setTool('arc');
    const historyDepth = useDesignStudioStore.getState().session?.history.past.length ?? 0;
    act(() => root.render(<PointerHarness />));
    const canvas = host.querySelector('canvas');
    if (canvas === null) throw new Error('expected a canvas');

    act(() => {
      click(canvas, 20, 20);
      click(canvas, 50, 20);
    });
    expect(useDesignStudioStore.getState().session?.history.past).toHaveLength(historyDepth);

    act(() => click(canvas, 20, 50));
    const session = useDesignStudioStore.getState().session;
    expect(session?.history.present.entities).toEqual([
      {
        kind: 'arc',
        id: 'entity',
        center: { x: 20, y: 20 },
        radiusMm: 30,
        startAngleDeg: 0,
        sweepDeg: 90,
        layerId: 'secondary',
      },
    ]);
    expect(session?.history.past).toHaveLength(historyDepth + 1);
    expect([...(session?.selectedIds ?? [])]).toEqual(['entity']);

    act(() => useDesignStudioStore.getState().undo());
    expect(useDesignStudioStore.getState().session?.history.present.entities).toHaveLength(0);
    act(() => useDesignStudioStore.getState().redo());
    expect(useDesignStudioStore.getState().session?.history.present.entities).toHaveLength(1);
  });

  it('uses an on-radius object snap instead of Ortho for the Arc end', () => {
    useDesignStudioStore.setState({
      session: createDesignSession({
        entities: [
          {
            kind: 'line',
            id: 'guide',
            start: { x: 44, y: 38 },
            end: { x: 70, y: 38 },
          },
        ],
      }),
      stash: null,
    });
    useDesignStudioStore.getState().toggleOrtho();
    useDesignStudioStore.getState().setTool('arc');
    act(() => root.render(<PointerHarness />));
    const canvas = host.querySelector('canvas');
    if (canvas === null) throw new Error('expected a canvas');

    act(() => {
      click(canvas, 20, 20);
      click(canvas, 50, 20);
      click(canvas, 43, 37);
    });

    const arc = useDesignStudioStore.getState().session?.history.present.entities[1];
    expect(arc?.kind).toBe('arc');
    if (arc?.kind !== 'arc') throw new Error('expected an Arc');
    expect(arc.radiusMm).toBe(30);
    expect(arc.sweepDeg).toBeCloseTo(36.869_897_65, 6);
  });

  it('rejects an off-radius Arc snap and reports the projected endpoint', () => {
    useDesignStudioStore.setState({
      session: createDesignSession({
        entities: [
          {
            kind: 'line',
            id: 'guide',
            start: { x: 80, y: 80 },
            end: { x: 100, y: 80 },
          },
        ],
      }),
      stash: null,
    });
    useDesignStudioStore.getState().setTool('arc');
    act(() => root.render(<PointerHarness />));
    const canvas = host.querySelector('canvas');
    if (canvas === null) throw new Error('expected a canvas');

    act(() => {
      click(canvas, 20, 20);
      click(canvas, 50, 20);
      move(canvas, 78, 79);
    });

    const session = useDesignStudioStore.getState().session;
    expect(session?.activeSnap).toBeNull();
    expect(session?.cursorMm?.x).toBeCloseTo(41.213_203_44, 6);
    expect(session?.cursorMm?.y).toBeCloseTo(41.213_203_44, 6);
  });

  it('exits to Select without a stray Arc after a native-like end double-click', () => {
    useDesignStudioStore.getState().setTool('arc');
    act(() => root.render(<PointerHarness />));
    const canvas = host.querySelector('canvas');
    if (canvas === null) throw new Error('expected a canvas');

    act(() => {
      click(canvas, 20, 20);
      click(canvas, 50, 20);
      click(canvas, 20, 50);
      click(canvas, 20, 50);
      canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    const session = useDesignStudioStore.getState().session;
    expect(session?.history.present.entities).toHaveLength(1);
    expect(session?.pointSequence).toBeNull();
    expect(session?.selectedIds.size).toBe(0);
    expect(session?.tool).toBe('select');
  });
});
