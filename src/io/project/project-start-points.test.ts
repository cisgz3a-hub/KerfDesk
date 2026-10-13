import { describe, expect, it } from 'vitest';
import { createProject, type Project, type ProjectStartPoints } from '../../core/scene';
import { deserializeProject, deserializeProjectValue } from './deserialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { serializeProject } from './serialize-project';

describe('project start point persistence', () => {
  it.each<ProjectStartPoints>([
    { frame: { edge: 2, fraction: 0.4 }, job: { x: -4.25, y: 18.7 } },
    { frame: { edge: 0, fraction: 0 } },
    { job: { x: 0.25, y: 1, relative: true } },
  ])('roundtrips an exact selection or relative preference: %j', (startPoints) => {
    const original = { ...createProject(), startPoints };
    const prepared = prepareProjectForPersistence(original);
    expect(prepared.kind).toBe('ok');
    const result = deserializeProject(serializeProject(original));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.project.startPoints).toEqual(startPoints);
  });

  it('does not add a preference to a legacy project', () => {
    const result = deserializeProject(serializeProject(createProject()));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.project).not.toHaveProperty('startPoints');
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
