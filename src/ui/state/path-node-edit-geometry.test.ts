import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  pathUsesOperation,
  polylineToCurveSubpath,
  type ColoredPath,
  type ImportedSvg,
} from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { deletePathsNodes, editPathsNodesByDelta } from './path-node-edit-geometry';

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
  it.each([
    ['move', () => editPathsNodesByDelta([SOURCE_PATH], [nodeRef(1)], 2, 3)],
    ['delete', () => deletePathsNodes([SOURCE_PATH], [nodeRef(1)])],
  ])('preserves output metadata while invalidating stale curves after a %s', (_name, edit) => {
    const path = edit()?.paths[0];

    expect(path?.operationIds).toEqual(['cut-operation']);
    expect(path?.strokeWidthMm).toBe(0.8);
    expect(path?.curves).toBeUndefined();
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
