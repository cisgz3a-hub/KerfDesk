import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Transform,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

function load(transform: Transform): void {
  const square: ImportedSvg = {
    kind: 'imported-svg',
    id: 'sq',
    source: 'sq.svg',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform,
    operationIds: ['cut'],
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 20 },
              { x: 0, y: 20 },
            ],
          },
        ],
      },
    ],
  };
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [square],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: 'sq',
    additionalSelectedIds: new Set(),
  });
}

const square = () => useStore.getState().project.scene.objects[0] as ImportedSvg;

beforeEach(resetStore);

describe('filletSelection', () => {
  it('rounds every corner at the world radius in one undo step, and removes them again', () => {
    load({ ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 2 });
    useStore.getState().filletSelection(10, 'round');
    const arcs = square().paths[0]?.curves?.[0]?.segments.filter(
      (segment) => segment.kind === 'elliptical-arc',
    );
    expect(arcs).toHaveLength(4);
    expect(arcs?.[0]).toMatchObject({ radiusX: 5, radiusY: 5 });
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(square().paths[0]?.polylines[0]?.points.length).toBeGreaterThan(8);

    useStore.getState().filletSelection(0, 'remove');
    const segments = square().paths[0]?.curves?.[0]?.segments ?? [];
    expect(segments.every((segment) => segment.kind === 'line')).toBe(true);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe('Sharpened 4 corners.');
  });

  it('leaves an unevenly stretched object alone and says why', () => {
    load({ ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 1 });
    const before = useStore.getState().project;
    useStore.getState().filletSelection(2, 'round');
    expect(useStore.getState().project).toBe(before);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('stretched unevenly');
  });
});
