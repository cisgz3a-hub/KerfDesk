import { describe, expect, it } from 'vitest';
import {
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_TILING,
  PROJECT_SCHEMA_VERSION,
  type CncTileRegistration,
} from '../../core/scene';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';
import { migrateToCurrent } from './migrations';

const registration: CncTileRegistration = {
  toolId: 'missing-but-preserved',
  holeDiameterMm: 3.075,
  depthMm: 0.02,
  depthPerPassMm: 0.01,
  feedMmPerMin: 0.5,
  plungeMmPerMin: 0.25,
  spindleRpm: 500,
};

describe('registration project identity', () => {
  it.each([true, false])(
    'round trips every explicit field, including unavailable cutter identity, enabled=%s',
    (enabled) => {
      const project = {
        ...createProject(),
        machine: {
          ...DEFAULT_CNC_MACHINE_CONFIG,
          tiling: { ...DEFAULT_CNC_TILING, registrationHoles: enabled, registration },
        },
      };
      const result = prepareProjectForPersistence(project);
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') expect(result.project.machine).toEqual(project.machine);
    },
  );

  it('migrates v5 without seeding a registration recipe or changing its document', () => {
    const legacy = {
      ...createProject(),
      schemaVersion: 5,
      machine: { ...DEFAULT_CNC_MACHINE_CONFIG, tiling: DEFAULT_CNC_TILING },
    };
    const migrated = migrateToCurrent(legacy, 5);
    expect(migrated).toEqual({
      kind: 'ok',
      raw: { ...legacy, schemaVersion: PROJECT_SCHEMA_VERSION },
      steps: [5],
    });
    const result = deserializeProject(JSON.stringify(legacy));
    if (result.kind !== 'ok' || result.project.machine?.kind !== 'cnc')
      throw new Error('fixture did not reload');
    expect(result.project.machine.tiling).toEqual(DEFAULT_CNC_TILING);
    expect(result.migratedFrom).toBe(5);
    expect(result.project.schemaVersion).toBe(6);
  });

  it('writes the registration plan at v6 so older readers cannot silently ignore it', () => {
    const project = {
      ...createProject(),
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        tiling: { ...DEFAULT_CNC_TILING, registrationHoles: true, registration },
      },
    };
    const written = JSON.parse(serializeProject(project)) as Record<string, unknown>;
    expect(written['schemaVersion']).toBe(6);
    const result = deserializeProject(JSON.stringify(written));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.project.machine).toEqual(project.machine);
    expect(deserializeProject(JSON.stringify({ ...written, schemaVersion: 7 }))).toEqual({
      kind: 'schema-too-new',
      sawVersion: 7,
    });
  });

  it.each([
    'depthMm',
    'depthPerPassMm',
    'feedMmPerMin',
    'plungeMmPerMin',
    'spindleRpm',
    'holeDiameterMm',
  ] as const)('does not silently save malformed %s', (key) => {
    const project = {
      ...createProject(),
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        tiling: { ...DEFAULT_CNC_TILING, registration: { ...registration, [key]: 0 } },
      },
    };
    expect(prepareProjectForPersistence(project).kind).toBe('invalid');
  });
});
