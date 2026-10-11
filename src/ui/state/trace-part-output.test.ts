import { beforeEach, describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import { pointInPolygon } from '../../core/geometry';
import { createLayer, IDENTITY_TRANSFORM, type Project, type TracedImage } from '../../core/scene';
import { carriedSubpathParents } from '../../core/scene/subpath-nesting';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { actions, load, pieces, rings, square, trace } from './trace-part.test-support';

describe('trace part output and project persistence', () => {
  beforeEach(resetStore);

  it.each(['line', 'fill'] as const)(
    'preserves compiled %s geometry and burn coverage before any movement',
    (mode) => {
      const object = { ...trace(), transform: IDENTITY_TRANSFORM };
      load(object);
      useStore.setState((state) => ({
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            layers: [createLayer({ id: 'cut', color: '#000000', mode })],
          },
        },
      }));
      const before = useStore.getState().project;
      actions.detachTracePart('trace', 0, 1);
      expect(compiledGeometry(useStore.getState().project)).toEqual(compiledGeometry(before));
      for (let y = 1; y < 110; y += 3) {
        for (let x = 1; x < 110; x += 3) {
          const point = { x, y };
          const original =
            object.paths[0]!.polylines.filter((line) => pointInPolygon(point, line.points)).length %
            2;
          const detachedCoverage = pieces().filter(
            (piece) =>
              piece.paths[0]!.polylines.filter((line) => pointInPolygon(point, line.points))
                .length %
                2 ===
              1,
          ).length;
          expect(detachedCoverage).toBe(original);
        }
      }
    },
  );

  it('round-trips moved parts through the saved project without losing contours or geometry', () => {
    const object = trace();
    load(object);
    const id = actions.detachTracePart('trace', 0, 1)!;
    useStore.getState().applyObjectTransform(id, { ...object.transform, x: 40 });
    const beforeSave = useStore.getState().project;
    const loaded = deserializeProject(serializeProject(beforeSave));
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') throw new Error('Expected saved trace parts to open.');
    expect(loaded.project.scene.objects).toHaveLength(2);
    expect(compiledGeometry(loaded.project)).toEqual(compiledGeometry(beforeSave));
    const loadedPieces = loaded.project.scene.objects as ReadonlyArray<TracedImage>;
    expect(
      loadedPieces.map((piece) =>
        piece.paths.reduce(
          (total, path) => total + (path.curves?.length ?? path.polylines.length),
          0,
        ),
      ),
    ).toEqual([1, 2]);
    expect(loadedPieces.find((piece) => piece.id === id)?.transform).toEqual({
      ...object.transform,
      x: 40,
    });
    expect(loadedPieces.every((piece) => piece.traceSourceId === undefined)).toBe(true);
    expect(loadedPieces.map((piece) => carriedSubpathParents(piece.paths[0]!))).toEqual([
      [-1],
      [-1, 0],
    ]);
  });

  it('keeps disjoint colour operations and their compiled geometry when separating a colour region', () => {
    load({
      ...trace([
        { ...rings(), operationIds: ['cut'] },
        { color: '#ff0000', operationIds: ['red'], polylines: [square(120)] },
      ]),
      transform: IDENTITY_TRANSFORM,
    });
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: [
            createLayer({ id: 'cut', color: '#000000', mode: 'fill' }),
            createLayer({ id: 'red', color: '#ff0000', mode: 'line' }),
          ],
        },
      },
    }));
    const before = useStore.getState().project;
    actions.detachTracePart('trace', 0, 1);
    const after = useStore.getState().project;
    expect(compiledGeometry(after)).toEqual(compiledGeometry(before));
    expect(
      new Set(compileJob(after.scene, after.device).groups.map((group) => group.layerId)),
    ).toEqual(new Set(['cut', 'red']));
    expect(pieces()[0]!.paths[1]!.operationIds).toEqual(['red']);
    expect(pieces()[1]!.paths[0]!.operationIds).toEqual(['cut']);
  });
});

function compiledGeometry(project: Project): ReadonlyArray<string> {
  return compileJob(project.scene, project.device)
    .groups.flatMap((group) => {
      if (group.kind !== 'cut' && group.kind !== 'fill') throw new Error('Expected vector output.');
      return group.segments.map((segment) =>
        JSON.stringify({
          kind: group.kind,
          layerId: group.layerId,
          power: group.power,
          speed: group.speed,
          polyline: segment.polyline,
          closed: segment.closed,
        }),
      );
    })
    .sort();
}
