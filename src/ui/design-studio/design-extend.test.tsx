import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Sketch } from '../../core/design';
import { createDesignSession } from './design-session';
import { useDesignStudioStore as studio } from './design-studio-store';
import { useDesignPointer } from './use-design-pointer';
import { handleDesignStudioKey } from './design-shortcuts';
import { DesignStatusBar } from './DesignStatusBar';
import { extensionHint } from './design-extend';
import { applyDesignSketch } from '../state/design-apply-mutation';
import { createProject } from '../../core/scene';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const sketch: Sketch = {
  entities: [
    { kind: 'line', id: 'line', start: { x: 3, y: 2 }, end: { x: 13, y: 2 }, layerId: 'default' },
    { kind: 'line', id: 'edge', start: { x: 23, y: -10 }, end: { x: 23, y: 20 } },
  ],
};
let scale = 8;
const surface = {
  toMm: (event: React.PointerEvent<HTMLCanvasElement>) => ({ x: event.clientX, y: event.clientY }),
  pxPerMm: () => scale,
};

function Harness(): JSX.Element {
  const pointer = useDesignPointer(surface, () => 'unused');
  return (
    <div onKeyDown={(event) => handleDesignStudioKey(event, () => undefined)}>
      <canvas {...pointer} />
      <DesignStatusBar />
    </div>
  );
}

describe('Design Studio Extend interaction', () => {
  let host: HTMLDivElement;
  let root: Root;
  let canvas: HTMLCanvasElement;
  const session = () => studio.getState().session!;
  const pointer = (type: string, x: number, y: number, button = 0) =>
    act(() => {
      canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button }));
    });
  const key = (value: string, ctrlKey = false) =>
    act(() => {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value, ctrlKey }));
    });

  beforeEach(() => {
    scale = 8;
    studio.setState({ session: createDesignSession(sketch), stash: null });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Harness />));
    canvas = host.querySelector('canvas')!;
    key('e');
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    studio.setState({ session: null, stash: null });
  });

  it('previews raw endpoints with grid snap enabled, commits the preview, and undoes/redoes', () => {
    expect(session().tool).toBe('extend');
    expect(session().snapEnabled).toBe(true);
    pointer('pointermove', 13, 2);
    expect(session().extendPreview).toMatchObject({ from: { x: 13, y: 2 }, to: { x: 23, y: 2 } });
    expect(session().activeSnap).toBeNull();
    expect(host.textContent).toContain('Click to extend');
    expect(session().history.past).toHaveLength(0);
    pointer('pointerdown', 13, 2);
    pointer('pointerup', 13, 2);
    expect(session().history.present.entities[0]).toMatchObject({ end: { x: 23, y: 2 } });
    expect(session().history.past).toHaveLength(1);
    key('z', true);
    expect(session().history.present).toBe(sketch);
    expect(session().extendPreview).toBeNull();
    key('y', true);
    expect(session().history.present.entities[0]).toMatchObject({ end: { x: 23, y: 2 } });
  });

  it('explains misses and existing contact without creating undo steps', () => {
    pointer('pointermove', 3, 2);
    expect(host.textContent).toContain('No boundary ahead');
    pointer('pointerdown', 3, 2);
    expect(session().history.past).toHaveLength(0);
    pointer('pointerdown', 13, 2);
    pointer('pointermove', 23, 2);
    expect(host.textContent).toContain('already touches');
    pointer('pointerdown', 23, 2);
    expect(session().history.past).toHaveLength(1);
  });

  it('keeps the same screen-space picking tolerance at different scales', () => {
    pointer('pointermove', 13, 4);
    expect(session().extendPreview).toBeNull();
    scale = 2;
    pointer('pointermove', 13, 4);
    expect(session().extendPreview?.reason).toBe('ready');
  });

  it('ignores camera buttons and clears preview on leaving or pressing Escape', () => {
    pointer('pointermove', 13, 2);
    pointer('pointerdown', 13, 2, 1);
    pointer('pointerdown', 13, 2, 2);
    expect(session().history.past).toHaveLength(0);
    pointer('pointerout', 13, 2);
    expect(session().extendPreview).toBeNull();
    pointer('pointermove', 13, 2);
    key('Escape');
    expect(session().tool).toBe('select');
    expect(session().extendPreview).toBeNull();
  });

  it('uses the existing Apply boundary and preserves construction exclusion', () => {
    pointer('pointerdown', 13, 2);
    const applied = applyDesignSketch(
      { project: createProject(), undoStack: [] },
      session().history.present,
      ['line-output', 'edge-output'],
    );
    expect(applied?.project.scene.objects).toHaveLength(2);
    const construction = {
      ...sketch,
      entities: sketch.entities.map((entity) => ({ ...entity, construction: true })),
    };
    act(() => studio.setState({ session: createDesignSession(construction) }));
    act(() => studio.getState().extendAt({ x: 13, y: 2 }, 1));
    expect(session().history.present.entities[0]).toMatchObject({
      construction: true,
      layerId: 'default',
    });
    expect(
      applyDesignSketch({ project: createProject(), undoStack: [] }, session().history.present, [
        'a',
        'b',
      ]),
    ).toBeNull();
  });

  it('explains a curved source without adding history', () => {
    act(() =>
      studio.setState({
        session: {
          ...createDesignSession({
            entities: [
              {
                kind: 'arc',
                id: 'arc',
                center: { x: 3, y: 2 },
                radiusMm: 10,
                startAngleDeg: 0,
                sweepDeg: 90,
              },
            ],
          }),
          tool: 'extend',
        },
      }),
    );
    pointer('pointermove', 13, 2);
    expect(host.textContent).toContain('This end is curved');
    pointer('pointerdown', 13, 2);
    expect(session().history.past).toHaveLength(0);
    expect(
      extensionHint({
        entityId: 'a',
        from: { x: 0, y: 0 },
        to: null,
        end: 'end',
        reason: 'overlap',
      }),
    ).toContain('overlaps');
  });
});
