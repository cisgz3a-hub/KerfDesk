import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  pathUsesOperation,
  polylineToCurveSubpath,
  type ColoredPath,
  type ImportedSvg,
  type TracedImage,
} from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { boundsForPaths, deletePathsNodes, editPathsNodesByDelta } from './path-node-edit-geometry';
import { splitTracedImage } from './trace-break-apart';

const SOURCE_PATH: ColoredPath = {
  color: '#123456',
  operationIds: ['cut-operation'],
  strokeWidthMm: 0.8,
  polylines: [
    {
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ],
      closed: false,
    },
  ],
  curves: [
    polylineToCurveSubpath({
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ],
      closed: false,
    }),
  ],
};

describe('compatibility-polyline node editing', () => {
  it('moves only the addressed polyline and preserves untouched geometry identities', () => {
    const untouched = {
      closed: false,
      points: [
        { x: 40, y: 0 },
        { x: 50, y: 0 },
      ],
    };
    const path: ColoredPath = {
      color: '#000000',
      polylines: [SOURCE_PATH.polylines[0]!, untouched],
    };
    const edited = editPathsNodesByDelta([path, SOURCE_PATH], [nodeRef(1)], 2, 3);
    expect(edited?.paths[0]?.polylines[0]?.points[1]).toEqual({ x: 7, y: 3 });
    expect(edited?.paths[0]?.polylines[1]).toBe(untouched);
    expect(edited?.paths[1]).toBe(SOURCE_PATH);
    expect(path.polylines[0]?.points[1]).toEqual({ x: 5, y: 0 });
    expect(editPathsNodesByDelta([path], [nodeRef(1)], 0, 0)).toBeNull();
  });

  it('preserves untouched canonical subpaths and their existing compatibility samples', () => {
    const untouched = {
      closed: false,
      points: [
        { x: 40, y: 0 },
        { x: 45, y: 0 },
        { x: 50, y: 0 },
      ],
    };
    const untouchedCurve = polylineToCurveSubpath(untouched);
    const path: ColoredPath = {
      ...SOURCE_PATH,
      curves: [...SOURCE_PATH.curves!, untouchedCurve],
      polylines: [...SOURCE_PATH.polylines, untouched],
    };
    const edited = editPathsNodesByDelta([path], [{ ...nodeRef(1), geometry: 'curve' }], 2, 3)
      ?.paths[0];
    expect(edited?.curves?.[0]?.segments[0]?.to).toEqual({ x: 7, y: 3 });
    expect(edited?.curves?.[1]).toBe(untouchedCurve);
    expect(edited?.polylines[1]).toBe(untouched);
    expect(boundsForPaths([path])).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 0 });
    expect(boundsForPaths([edited!])).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 3 });
  });

  it.each(['move', 'delete'] as const)(
    'preserves holes after a canonical %s with unpaired compatibility contours',
    (edit) => {
      const square = (x: number, size: number) => ({
        closed: true,
        points: [
          { x, y: x },
          { x: x + size, y: x },
          { x: x + size, y: x + size },
          { x, y: x + size },
        ],
      });
      const outer = square(0, 100);
      const hole = square(20, 10);
      const path: ColoredPath = {
        color: '#000000',
        fillRule: 'evenodd',
        curves: [polylineToCurveSubpath(outer), polylineToCurveSubpath(hole)],
        polylines: [hole, outer, hole],
      };
      const refs = (edit === 'move' ? [0, 1, 2, 3] : [1]).map((pointIndex) => ({
        ...nodeRef(pointIndex),
        polylineIndex: 1,
        geometry: 'curve' as const,
      }));
      const edited =
        edit === 'move'
          ? editPathsNodesByDelta([path], refs, 20, 20)
          : deletePathsNodes([path], refs);
      if (edited === null) throw new Error('Expected a canonical edit.');
      const object: TracedImage = {
        id: 'art',
        kind: 'traced-image',
        source: 'trace.png',
        transform: IDENTITY_TRANSFORM,
        bounds: boundsForPaths(edited.paths),
        traceMode: 'filled-contours',
        paths: edited.paths,
      };
      expect(object.paths[0]?.polylines[0]?.points[0]).toEqual({ x: 0, y: 0 });
      // Break Apart must not turn an interior hole into an independent solid shape.
      expect(splitTracedImage(object, (index) => `part-${index}`)).toEqual([]);
      expect(path.polylines).toEqual([hole, outer, hole]);
    },
  );

  it.each([
    ['move', () => editPathsNodesByDelta([SOURCE_PATH], [nodeRef(1)], 2, 3)],
    ['delete', () => deletePathsNodes([SOURCE_PATH], [nodeRef(1)])],
  ])('preserves output metadata while invalidating stale curves after a %s', (_name, edit) => {
    const path = edit()?.paths[0];

    expect(path?.operationIds).toEqual(['cut-operation']);
    expect(path?.strokeWidthMm).toBe(0.8);
    expect(path?.curves).toBeUndefined();
  });

  it('uses canonical curve extrema for bounds and compatibility points when curves are absent', () => {
    expect(
      boundsForPaths([
        {
          color: '#123456',
          polylines: [
            {
              points: [
                { x: 0, y: 0 },
                { x: 6, y: 0 },
              ],
              closed: false,
            },
          ],
          curves: [
            {
              start: { x: 0, y: 0 },
              segments: [
                {
                  kind: 'cubic',
                  control1: { x: 2, y: 1 },
                  control2: { x: 4, y: 0 },
                  to: { x: 6, y: 0 },
                },
              ],
              closed: false,
            },
          ],
        },
      ]).maxY,
    ).toBeCloseTo(4 / 9, 12);

    expect(
      boundsForPaths([
        {
          color: '#123456',
          polylines: [
            {
              points: [
                { x: -3, y: 2 },
                { x: 8, y: 11 },
              ],
              closed: false,
            },
          ],
        },
      ]),
    ).toEqual({ minX: -3, minY: 2, maxX: 8, maxY: 11 });
  });

  it('retains the edited path binding through save and reopen', () => {
    const path = editPathsNodesByDelta([SOURCE_PATH], [nodeRef(1)], 2, 3)?.paths[0];
    if (path === undefined) throw new Error('edited path missing');
    const operation = createLayer({ id: 'cut-operation', color: '#abcdef', name: 'Cut' });
    const object: ImportedSvg = {
      kind: 'imported-svg',
      id: 'art',
      source: 'art.svg',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 3 },
      transform: IDENTITY_TRANSFORM,
      paths: [path],
    };
    const base = createProject();
    const project = { ...base, scene: { objects: [object], layers: [operation], groups: [] } };

    const reopened = deserializeProject(serializeProject(project));

    expect(reopened.kind).toBe('ok');
    if (reopened.kind !== 'ok') throw new Error(reopened.kind);
    const reopenedObject = reopened.project.scene.objects[0];
    if (reopenedObject?.kind !== 'imported-svg') throw new Error('artwork missing');
    expect(reopenedObject.paths[0]?.operationIds).toEqual(['cut-operation']);
    expect(reopenedObject.paths[0]?.strokeWidthMm).toBe(0.8);
    expect(pathUsesOperation(reopenedObject, reopenedObject.paths[0]!, operation)).toBe(true);
  });
});

function nodeRef(pointIndex: number) {
  return { objectId: 'art', pathIndex: 0, polylineIndex: 0, pointIndex };
}
