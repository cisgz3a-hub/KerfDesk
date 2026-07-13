import { describe, expect, it } from 'vitest';
import { addObject, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function projectWithAnchors(): Project {
  const base = createProject();
  return {
    ...base,
    scene: addObject(base.scene, {
      kind: 'imported-svg',
      id: 'tabbed',
      source: 'tabbed.svg',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [],
      cncTabAnchors: [{ layerColor: '#ff0000', pathIndex: 0, polylineIndex: 0, pathT: 0.25 }],
    }),
  };
}

describe('project CNC tab anchors', () => {
  it('round-trips normalized manual positions', () => {
    const result = deserializeProject(serializeProject(projectWithAnchors()));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.scene.objects[0]?.cncTabAnchors).toEqual([
        { layerColor: '#ff0000', pathIndex: 0, polylineIndex: 0, pathT: 0.25 },
      ]);
    }
  });

  it('rejects non-normalized positions', () => {
    const raw = JSON.parse(serializeProject(projectWithAnchors())) as Record<string, unknown>;
    const scene = raw['scene'] as { objects: Array<Record<string, unknown>> };
    scene.objects[0]!['cncTabAnchors'] = [
      { layerColor: '#ff0000', pathIndex: 0, polylineIndex: 0, pathT: 1.5 },
    ];
    const result = deserializeProject(JSON.stringify(raw));
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain('cncTabAnchors[0].pathT');
  });
});
