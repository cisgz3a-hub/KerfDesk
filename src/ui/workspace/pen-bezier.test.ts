import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type ShapeObject,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { penEndpointAt } from './pen-continuation';
import { finishPen, updatePenCursor } from './pen-tool';

const LINE: ImportedSvg = {
  kind: 'imported-svg',
  id: 'line',
  source: 'line.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
  transform: { ...IDENTITY_TRANSFORM, x: 50, y: 50, scaleX: 2, scaleY: 2 },
  operationIds: ['cut'],
  paths: [
    {
      color: '#000000',
      curves: [
        { start: { x: 0, y: 0 }, segments: [{ kind: 'line', to: { x: 10, y: 0 } }], closed: false },
      ],
      polylines: [{ points: [], closed: false }],
    },
  ],
};

beforeEach(() => {
  resetStore();
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [LINE],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
      },
    },
  });
  useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });
});

describe('Bezier pen', () => {
  it('turns a click-and-drag into a smooth curve node of an exact cubic path', () => {
    const ui = useUiStore.getState();
    ui.setPenDraft({ vertices: [{ x: 0, y: 0 }], cursor: null, handles: [null] });
    useUiStore.getState().setPenDraft({
      vertices: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
      cursor: null,
      handles: [null, null],
    });
    updatePenCursor({ x: 25, y: 5 }, false, true);
    useUiStore.getState().setPenDraft({
      ...useUiStore.getState().penDraft!,
      vertices: [...useUiStore.getState().penDraft!.vertices, { x: 30, y: 20 }],
      handles: [...useUiStore.getState().penDraft!.handles!, null],
    });
    expect(
      finishPen({
        closed: false,
        project: useStore.getState().project,
        drawShape: useStore.getState().drawShape,
      }),
    ).toBe(true);
    const drawn = useStore.getState().project.scene.objects.at(-1) as ShapeObject;
    expect(drawn.spec.kind).toBe('polyline');
    expect(drawn.paths[0]?.curves?.[0]?.segments).toEqual([
      { kind: 'cubic', control1: { x: 0, y: 0 }, control2: { x: 15, y: -5 }, to: { x: 20, y: 0 } },
      {
        kind: 'cubic',
        control1: { x: 25, y: 5 },
        control2: { x: 30, y: 20 },
        to: { x: 30, y: 20 },
      },
    ]);
  });

  it('continues an open path from its endpoint in one undo step', () => {
    const project = useStore.getState().project;
    const start = penEndpointAt(project, { x: 70.3, y: 50 }, 1);
    expect(start?.continuation).toEqual({ objectId: 'line', pathIndex: 0, curveIndex: 0, node: 1 });
    useUiStore.getState().setPenDraft({
      vertices: [start!.point, { x: 70, y: 70 }],
      cursor: null,
      handles: [null, null],
      continueFrom: start!.continuation,
    });
    expect(finishPen({ closed: false, project, drawShape: useStore.getState().drawShape })).toBe(
      true,
    );
    const line = useStore.getState().project.scene.objects[0] as ImportedSvg;
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    expect(line.paths[0]?.curves?.[0]?.segments.map((segment) => segment.to)).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
});
