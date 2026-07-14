import { describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject, type Project } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';

describe('prepareProjectForPersistence', () => {
  it('normalizes the current project before producing validated persistence JSON', () => {
    const project = createProject();
    const withoutNormalizedGroups = {
      ...project,
      scene: { objects: project.scene.objects, layers: project.scene.layers },
    } as Project;

    const prepared = prepareProjectForPersistence(withoutNormalizedGroups);

    expect(prepared.kind).toBe('ok');
    if (prepared.kind !== 'ok') return;
    expect(prepared.project.scene.groups).toEqual([]);
    expect(deserializeProject(prepared.json)).toEqual({ kind: 'ok', project: prepared.project });
  });

  it('rejects invalid runtime state instead of writing a project that cannot reopen', () => {
    const project = {
      ...createProject(),
      workspace: { ...createProject().workspace, width: Number.NaN },
    } as Project;

    expect(prepareProjectForPersistence(project)).toEqual({
      kind: 'invalid',
      reason: 'missing or invalid `workspace.width`',
    });
  });

  it('rejects CNC state that validation would silently normalize on disk', () => {
    const project = {
      ...createProject(),
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, safeZMm: Number.NaN },
      },
    } as Project;

    expect(prepareProjectForPersistence(project)).toEqual({
      kind: 'invalid',
      reason:
        'saving would change `machine.params.safeZMm` during validation; repair or reload the project before saving',
    });
  });

  it('rejects controller state that validation would silently normalize on disk', () => {
    const project = {
      ...createProject(),
      device: { ...createProject().device, controllerKind: 'unknown-controller' },
    } as unknown as Project;

    expect(prepareProjectForPersistence(project)).toEqual({
      kind: 'invalid',
      reason:
        'saving would change `device.controllerKind` during validation; repair or reload the project before saving',
    });
  });
});
