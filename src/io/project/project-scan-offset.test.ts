import { describe, expect, it } from 'vitest';
import { createProject, PROJECT_SCHEMA_VERSION } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

describe('project scan-offset IO', () => {
  it('back-fills missing scan-offset table on old .lf2 files', () => {
    const oldShape = JSON.stringify({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      device: {
        name: 'Old Profile',
        bedWidth: 300,
        bedHeight: 300,
        maxFeed: 3000,
        maxPowerS: 1000,
        origin: 'front-left',
        homing: { enabled: false, direction: 'front-left' },
        autofocusCommand: '',
      },
      workspace: { width: 300, height: 300, units: 'mm' },
      scene: { objects: [], layers: [] },
    });

    const result = deserializeProject(oldShape);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.device.scanningOffsets).toEqual([]);
    }
  });

  it('sorts a valid scan-offset table by speed on load', () => {
    const project = createProject();
    const text = serializeProject({
      ...project,
      device: {
        ...project.device,
        scanningOffsets: [
          { speedMmPerMin: 6000, offsetMm: 0.12 },
          { speedMmPerMin: 3000, offsetMm: 0.05 },
        ],
      },
    });

    const result = deserializeProject(text);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.device.scanningOffsets).toEqual([
        { speedMmPerMin: 3000, offsetMm: 0.05 },
        { speedMmPerMin: 6000, offsetMm: 0.12 },
      ]);
    }
  });

  it('reports invalid for malformed scan-offset tables', () => {
    const project = createProject();
    const text = JSON.stringify({
      ...project,
      device: {
        ...project.device,
        scanningOffsets: [{ speedMmPerMin: 0, offsetMm: '0.12' }],
      },
    });

    const result = deserializeProject(text);

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/device\.scanningOffsets/);
    }
  });
});
