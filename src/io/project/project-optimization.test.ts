import { describe, expect, it } from 'vitest';
import {
  createProject,
  DEFAULT_PROJECT_OPTIMIZATION,
  PROJECT_SCHEMA_VERSION,
  type Project,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

describe('project cut-planner settings', () => {
  it('back-fills defaults on older .lf2 files', () => {
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
      expect(result.project.optimization).toEqual(DEFAULT_PROJECT_OPTIMIZATION);
    }
  });

  it('migrates the legacy reduce-travel flag into the typed policy', () => {
    const text = serializeProject({
      ...createProject(),
      optimization: { reduceTravelMoves: false },
    } as unknown as Project);

    const result = deserializeProject(text);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.optimization).toMatchObject({
        reduceTravelMoves: false,
        travelPolicy: 'source-order',
      });
    }
  });

  it('rejects invalid legacy and typed policy values', () => {
    const invalidLegacy = serializeProject({
      ...createProject(),
      optimization: { reduceTravelMoves: 'sometimes' },
    } as unknown as Project);
    const invalidTyped = serializeProject({
      ...createProject(),
      optimization: {
        ...DEFAULT_PROJECT_OPTIMIZATION,
        pathDirection: 'sometimes-backwards',
      },
    } as unknown as Project);

    const legacyResult = deserializeProject(invalidLegacy);
    const typedResult = deserializeProject(invalidTyped);

    expect(legacyResult.kind).toBe('invalid');
    expect(typedResult.kind).toBe('invalid');
    if (legacyResult.kind === 'invalid') {
      expect(legacyResult.reason).toMatch(/optimization\.reduceTravelMoves/);
    }
    if (typedResult.kind === 'invalid') {
      expect(typedResult.reason).toMatch(/optimization\.pathDirection/);
    }
  });
});
