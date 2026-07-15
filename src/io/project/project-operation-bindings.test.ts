import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

describe('project operation bindings', () => {
  it('round-trips named operations and path-specific bindings in schema v3', () => {
    const cut = createLayer({ id: 'cut-op', name: 'Johann outline', color: '#2563eb' });
    const engrave = createLayer({
      id: 'engrave-op',
      name: 'Johann fill',
      color: '#dc2626',
      mode: 'fill',
    });
    const artwork: ImportedSvg = {
      kind: 'imported-svg',
      id: 'johann',
      source: 'Johann.svg',
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        { color: '#000000', operationIds: [cut.id], polylines: [square(20, 10)] },
        { color: '#000000', operationIds: [engrave.id], polylines: [square(10, 5)] },
      ],
    };
    const base = createProject();
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [artwork], layers: [cut, engrave] },
    };

    const loaded = deserializeProject(serializeProject(project));

    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') return;
    expect(loaded.project.scene.layers.map(({ id, name, color }) => ({ id, name, color }))).toEqual(
      [
        { id: 'cut-op', name: 'Johann outline', color: '#2563eb' },
        { id: 'engrave-op', name: 'Johann fill', color: '#dc2626' },
      ],
    );
    const paths = loaded.project.scene.objects[0];
    expect(
      paths !== undefined && 'paths' in paths ? paths.paths.map((path) => path.operationIds) : [],
    ).toEqual([['cut-op'], ['engrave-op']]);
  });
});

function square(width: number, height: number) {
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
  } as const;
}
