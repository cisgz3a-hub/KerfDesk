import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, PROJECT_SCHEMA_VERSION, type Project } from '../../core/scene';
import type * as ProjectModule from '../../core/scene/project';
import { type ProjectStartPoints } from '../../core/scene/start-points';
import { deserializeProject, deserializeProjectValue } from './deserialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { serializeProject } from './serialize-project';
import { migrateToCurrent } from './migrations';

afterEach(() => {
  vi.doUnmock('../../core/scene/project');
  vi.resetModules();
});

describe('project start point persistence', () => {
  it.each<ProjectStartPoints>([
    { frame: { edge: 2, fraction: 0.4 }, job: { x: -4.25, y: 18.7 } },
    { frame: { edge: 0, fraction: 0 } },
    { job: { x: 0.25, y: 1, relative: true } },
  ])('roundtrips an exact selection or relative preference: %j', (startPoints) => {
    const original = { ...createProject(), startPoints };
    const prepared = prepareProjectForPersistence(original);
    expect(prepared.kind).toBe('ok');
    if (prepared.kind === 'ok') expect(JSON.parse(prepared.json).schemaVersion).toBe(18);
    const result = deserializeProject(serializeProject(original));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.startPoints).toEqual(startPoints);
      expect(result.migratedFrom).toBeUndefined();
    }
  });

  it('loads schema 16 without inventing selected starts or changing existing fields', () => {
    const current = createProject();
    const legacy = { ...current, schemaVersion: 16 };
    const result = deserializeProject(JSON.stringify(legacy));
    expect(result).toMatchObject({ kind: 'ok', migratedFrom: 16 });
    if (result.kind === 'ok') {
      expect(result.project).not.toHaveProperty('startPoints');
      expect(result.project).toEqual(current);
    }
  });

  it('promotes v16 without rewriting fields, including already stored selections', () => {
    const raw = {
      ...createProject(),
      schemaVersion: 16,
      startPoints: { frame: { edge: 2, fraction: 0.4 }, job: { x: -4.25, y: 18.7 } },
    };
    const before = JSON.stringify(raw);
    expect(migrateToCurrent(raw, 16)).toEqual({
      kind: 'ok',
      raw: { ...raw, schemaVersion: PROJECT_SCHEMA_VERSION },
      steps: [16, 17],
    });
    expect(JSON.stringify(raw)).toBe(before);
    expect(deserializeProject(before)).toMatchObject({
      kind: 'ok',
      migratedFrom: 16,
      project: { startPoints: raw.startPoints },
    });
  });

  it('makes a schema 16 reader reject selected starts instead of silently ignoring them', async () => {
    const saved = serializeProject({
      ...createProject(),
      startPoints: { frame: { edge: 2, fraction: 0.4 }, job: { x: -4.25, y: 18.7 } },
    });
    // Re-run the existing version guard with the previous reader's schema cap.
    vi.resetModules();
    vi.doMock('../../core/scene/project', async (importOriginal) => ({
      ...(await importOriginal<typeof ProjectModule>()),
      PROJECT_SCHEMA_VERSION: 16,
    }));
    const oldReader = await import('./deserialize-project');
    expect(oldReader.deserializeProject(saved)).toEqual({
      kind: 'schema-too-new',
      sawVersion: 18,
    });
  });

  it.each([
    { frame: { edge: 4, fraction: 0 } },
    { frame: { edge: 0, fraction: -0.01 } },
    { frame: { edge: 1, fraction: 1.01 } },
    { job: { x: Infinity, y: 0 } },
    { job: { x: 0, y: NaN } },
    { job: { x: 2, y: 0, relative: true } },
    { job: { x: 0, y: 0, relative: 'true' } },
    [],
    null,
  ])('drops malformed optional data on Open: %j', (startPoints) => {
    const result = deserializeProjectValue({ ...createProject(), startPoints });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.project).not.toHaveProperty('startPoints');
  });

  it('keeps the independently valid selection and drops unknown fields', () => {
    const result = deserializeProjectValue({
      ...createProject(),
      startPoints: { frame: { edge: 1, fraction: 0.5, extra: 'junk' }, job: { x: NaN, y: 0 } },
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.startPoints).toEqual({ frame: { edge: 1, fraction: 0.5 } });
    }
  });

  it('refuses Save if validation would silently alter the selected output start', () => {
    const result = prepareProjectForPersistence({
      ...createProject(),
      startPoints: { frame: { edge: 2, fraction: 1.5 } },
    } as Project);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain('startPoints');
  });
});
