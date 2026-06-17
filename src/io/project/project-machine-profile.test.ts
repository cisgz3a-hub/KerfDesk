import { describe, expect, it } from 'vitest';
import { createProject, PROJECT_SCHEMA_VERSION } from '../../core/scene';
import { deserializeProject } from './deserialize-project';

describe('project machine profile IO', () => {
  it('back-fills missing no-go zones on old .lf2 files', () => {
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
      expect(result.project.device.noGoZones).toEqual([]);
    }
  });

  it('preserves valid no-go zones', () => {
    const project = createProject();
    const result = deserializeProject(
      JSON.stringify({
        ...project,
        device: {
          ...project.device,
          noGoZones: [
            {
              id: 'clamp-left',
              name: 'Left clamp',
              enabled: true,
              x: 5,
              y: 10,
              width: 20,
              height: 30,
            },
          ],
        },
      }),
    );

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.device.noGoZones).toEqual([
        {
          id: 'clamp-left',
          name: 'Left clamp',
          enabled: true,
          x: 5,
          y: 10,
          width: 20,
          height: 30,
        },
      ]);
    }
  });

  it('rejects malformed no-go zones', () => {
    const project = createProject();
    const result = deserializeProject(
      JSON.stringify({
        ...project,
        device: {
          ...project.device,
          noGoZones: [{ id: 'bad', name: 'Bad zone', enabled: true, x: 0, y: 0, width: 0 }],
        },
      }),
    );

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toMatch(/device\.noGoZones/);
  });
});
