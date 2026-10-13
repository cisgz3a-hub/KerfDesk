import { beforeEach, describe, expect, it } from 'vitest';
import { curveSegmentPoint } from '../../core/geometry/curve-segment-edit';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { beginPathSegmentDrag, updatePathSegmentDrag } from './path-segment-drag';

const LINE: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [{ kind: 'line', to: { x: 10, y: 0 } }],
  closed: false,
};

beforeEach(() => {
  resetStore();
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
    transform: { ...IDENTITY_TRANSFORM, x: 100, scaleX: 2, scaleY: 2 },
    operationIds: ['cut'],
    paths: [{ color: '#000000', curves: [LINE], polylines: [{ points: [], closed: false }] }],
  };
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [object],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
      },
    },
  });
});

describe('segment drag', () => {
  it('bends a straight line so the grabbed point follows the pointer', () => {
    const project = useStore.getState().project;
    const drag = beginPathSegmentDrag(project, { x: 110, y: 0.1 }, 0.1);
    if (drag === null) throw new Error('expected a segment drag');
    expect(drag.segment.t).toBeCloseTo(0.5, 6);
    updatePathSegmentDrag(
      drag,
      { x: 110, y: 6.1 },
      useStore.getState().reshapePathSegmentDuringInteraction,
    );
    const object = useStore.getState().project.scene.objects[0];
    const curve =
      object !== undefined && 'paths' in object ? object.paths[0]?.curves?.[0] : undefined;
    expect(curve?.segments[0]?.kind).toBe('cubic');
    const grabbed = curveSegmentPoint(curve as CurveSubpath, 0, drag.segment.t);
    expect(grabbed?.x).toBeCloseTo(5, 6);
    expect(grabbed?.y).toBeCloseTo(3, 6);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('starts no drag away from any segment', () => {
    expect(beginPathSegmentDrag(useStore.getState().project, { x: 50, y: 50 }, 0.1)).toBeNull();
  });
});
