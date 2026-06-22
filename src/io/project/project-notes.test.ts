import { describe, expect, it } from 'vitest';
import { createProject, PROJECT_SCHEMA_VERSION, type Project } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

describe('project notes .lf2 IO', () => {
  it('roundtrips project notes', () => {
    const original: Project = { ...createProject(), notes: 'Maple plaque\nFocus: 6 mm' };

    const result = deserializeProject(serializeProject(original));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.notes).toBe('Maple plaque\nFocus: 6 mm');
    }
  });

  it('back-fills missing project notes on older .lf2 files', () => {
    const oldShape = JSON.stringify({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      device: {
        name: 'Default',
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
      expect(result.project.notes).toBe('');
    }
  });

  it('reports invalid when project notes are not a string', () => {
    const raw = JSON.parse(serializeProject(createProject())) as Record<string, unknown>;
    raw['notes'] = ['not', 'text'];

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/notes/);
    }
  });
});
