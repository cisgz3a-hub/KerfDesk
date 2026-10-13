// Select Open Shapes Set to Fill and Select Circles (LightBurn Edit menu).
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  type SceneObject,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const OPEN: Polyline = {
  closed: false,
  points: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
  ],
};

function ring(radius: number): Polyline {
  const points = Array.from({ length: 48 }, (_, index) => {
    const angle = (index / 48) * Math.PI * 2;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
  return { closed: true, points };
}

function art(id: string, polylines: ReadonlyArray<Polyline>, operation: string): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: -20, minY: -20, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    operationIds: [operation],
    paths: [{ color: '#000000', polylines }],
  };
}

function load(objects: ReadonlyArray<SceneObject>): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects,
        layers: [
          createLayer({ id: 'cut', color: '#000000' }),
          createLayer({ id: 'fill', color: '#ff0000', mode: 'fill' }),
        ],
        groups: [],
      },
    },
  });
}

const selection = () => {
  const state = useStore.getState();
  return [state.selectedObjectId, ...state.additionalSelectedIds]
    .filter((id) => id !== null)
    .sort();
};

beforeEach(() => resetStore());

describe('Select Open Shapes Set to Fill', () => {
  it('selects open artwork on a Fill operation only', () => {
    load([
      art('open-line', [OPEN], 'cut'),
      art('open-fill', [OPEN], 'fill'),
      art('closed-fill', [ring(5)], 'fill'),
    ]);

    useStore.getState().selectOpenFillShapes();

    expect(selection()).toEqual(['open-fill']);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('Selected 1 object');
  });
});

describe('Select Circles', () => {
  it('selects circles by exact diameter or range and ignores other shapes', () => {
    load([
      art('small', [ring(1.5)], 'cut'),
      art('large', [ring(5)], 'cut'),
      art('line', [OPEN], 'cut'),
    ]);

    useStore.getState().selectCircles({ kind: 'exact', diameterMm: 3, toleranceMm: 0.01 });
    expect(selection()).toEqual(['small']);

    useStore.getState().selectCircles({ kind: 'range', minMm: 1, maxMm: 20 });
    expect(selection()).toEqual(['large', 'small']);
  });
});
