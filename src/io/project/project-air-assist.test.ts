import { describe, expect, it } from 'vitest';
import { addLayer, createLayer, createProject, type Project } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function projectWithLayer(): Project {
  const base = createProject();
  return {
    ...base,
    scene: addLayer(base.scene, createLayer({ id: 'L1', color: '#ff0000' })),
  };
}

describe('project air assist persistence', () => {
  it('backfills missing air assist fields from older projects', () => {
    const raw = JSON.parse(serializeProject(projectWithLayer())) as Record<string, unknown>;
    const device = raw.device as Record<string, unknown>;
    delete device.airAssistCommand;
    const scene = raw.scene as { layers: Array<Record<string, unknown>> };
    const firstLayer = scene.layers[0];
    if (firstLayer === undefined) throw new Error('expected project fixture layer');
    delete firstLayer.airAssist;

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.airAssistCommand).toBe('none');
    expect(result.project.scene.layers[0]?.airAssist).toBe(false);
  });

  it('reports invalid when the device air assist command is unknown', () => {
    const raw = JSON.parse(serializeProject(projectWithLayer())) as Record<string, unknown>;
    (raw.device as Record<string, unknown>).airAssistCommand = 'M106';

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/device\.airAssistCommand/);
    }
  });
});
