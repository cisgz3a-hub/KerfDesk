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
  it('backfills missing additive layer fields from older projects', () => {
    const raw = JSON.parse(serializeProject(projectWithLayer())) as Record<string, unknown>;
    const device = raw.device as Record<string, unknown>;
    delete device.airAssistCommand;
    const scene = raw.scene as { layers: Array<Record<string, unknown>> };
    const firstLayer = scene.layers[0];
    if (firstLayer === undefined) throw new Error('expected project fixture layer');
    delete firstLayer.airAssist;
    delete firstLayer.kerfOffsetMm;
    delete firstLayer.tabsEnabled;
    delete firstLayer.tabSizeMm;
    delete firstLayer.tabsPerShape;
    delete firstLayer.tabSkipInnerShapes;
    delete firstLayer.fillStyle;
    delete firstLayer.subLayers;

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.airAssistCommand).toBe('none');
    expect(result.project.scene.layers[0]?.airAssist).toBe(false);
    expect(result.project.scene.layers[0]?.kerfOffsetMm).toBe(0);
    expect(result.project.scene.layers[0]?.tabsEnabled).toBe(false);
    expect(result.project.scene.layers[0]?.tabSizeMm).toBe(0.5);
    expect(result.project.scene.layers[0]?.tabsPerShape).toBe(4);
    expect(result.project.scene.layers[0]?.tabSkipInnerShapes).toBe(true);
    expect(result.project.scene.layers[0]?.fillStyle).toBe('scanline');
    expect(result.project.scene.layers[0]?.subLayers).toEqual([]);
  });

  it('reports invalid when a layer fill style is unknown', () => {
    const raw = JSON.parse(serializeProject(projectWithLayer())) as Record<string, unknown>;
    const scene = raw.scene as { layers: Array<Record<string, unknown>> };
    const firstLayer = scene.layers[0];
    if (firstLayer === undefined) throw new Error('expected project fixture layer');
    firstLayer.fillStyle = 'spiral';

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/scene\.layers\[0\]\.fillStyle/);
    }
  });

  it('accepts Island Fill as a persisted layer fill style', () => {
    const raw = JSON.parse(serializeProject(projectWithLayer())) as Record<string, unknown>;
    const scene = raw.scene as { layers: Array<Record<string, unknown>> };
    const firstLayer = scene.layers[0];
    if (firstLayer === undefined) throw new Error('expected project fixture layer');
    firstLayer.fillStyle = 'island';

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.scene.layers[0]?.fillStyle).toBe('island');
    }
  });

  it('round-trips supported vector power modes and rejects unknown values', () => {
    const raw = JSON.parse(serializeProject(projectWithLayer())) as Record<string, unknown>;
    const scene = raw.scene as { layers: Array<Record<string, unknown>> };
    const firstLayer = scene.layers[0];
    if (firstLayer === undefined) throw new Error('expected project fixture layer');
    firstLayer.powerMode = 'dynamic';

    const accepted = deserializeProject(JSON.stringify(raw));
    expect(accepted.kind).toBe('ok');
    if (accepted.kind === 'ok') {
      expect(accepted.project.scene.layers[0]?.powerMode).toBe('dynamic');
    }

    firstLayer.powerMode = 'turbo';
    const rejected = deserializeProject(JSON.stringify(raw));
    expect(rejected.kind).toBe('invalid');
    if (rejected.kind === 'invalid') {
      expect(rejected.reason).toMatch(/scene\.layers\[0\]\.powerMode/);
    }
  });

  it('rejects Auto Fastest as a persisted layer fill style', () => {
    const raw = JSON.parse(serializeProject(projectWithLayer())) as Record<string, unknown>;
    const scene = raw.scene as { layers: Array<Record<string, unknown>> };
    const firstLayer = scene.layers[0];
    if (firstLayer === undefined) throw new Error('expected project fixture layer');
    firstLayer.fillStyle = 'auto';

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/scene\.layers\[0\]\.fillStyle/);
    }
  });

  it('reports invalid when a sub-layer operation mode is unknown', () => {
    const raw = JSON.parse(serializeProject(projectWithLayer())) as Record<string, unknown>;
    const scene = raw.scene as { layers: Array<Record<string, unknown>> };
    const firstLayer = scene.layers[0];
    if (firstLayer === undefined) throw new Error('expected project fixture layer');
    firstLayer.subLayers = [
      {
        id: 'sub-1',
        label: 'Bad operation',
        enabled: true,
        settings: { ...firstLayer, mode: 'scan' },
      },
    ];

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/scene\.layers\[0\]\.subLayers\[0\]\.settings\.mode/);
    }
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
