import { describe, expect, it } from 'vitest';
import { createProject, type Project } from '../../core/scene';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  deserializeMachineProfileDocument,
  serializeMachineProfileDocument,
} from '../machine-profile/machine-profile-io';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function projectWithArcs(laserArcMoves: unknown): string {
  const base: Project = createProject();
  const raw = JSON.parse(serializeProject(base)) as { device: Record<string, unknown> };
  raw.device.controllerKind = 'grbl-v1.1';
  raw.device.laserArcMoves = laserArcMoves;
  return JSON.stringify(raw);
}

describe('laser arc switch persistence (ADR-432)', () => {
  it('keeps an explicit off through a project round trip', () => {
    const loaded = deserializeProject(projectWithArcs('off'));
    if (loaded.kind !== 'ok') throw new Error('expected the project to load');
    expect(loaded.project.device.laserArcMoves).toBe('off');
    const again = deserializeProject(serializeProject(loaded.project));
    if (again.kind !== 'ok') throw new Error('expected the project to load');
    expect(again.project.device.laserArcMoves).toBe('off');
  });

  it('keeps an explicit on through a project round trip', () => {
    const loaded = deserializeProject(projectWithArcs('on'));
    if (loaded.kind !== 'ok') throw new Error('expected the project to load');
    expect(loaded.project.device.laserArcMoves).toBe('on');
    const again = deserializeProject(serializeProject(loaded.project));
    if (again.kind !== 'ok') throw new Error('expected the project to load');
    expect(again.project.device.laserArcMoves).toBe('on');
  });

  it('reads anything but off or on as the profile default', () => {
    for (const value of ['yes', true, 1, null]) {
      const loaded = deserializeProject(projectWithArcs(value));
      if (loaded.kind !== 'ok') throw new Error('expected the project to load');
      expect(loaded.project.device.laserArcMoves).toBeUndefined();
    }
  });

  it('keeps an explicit off through a machine profile document', () => {
    const profile = { ...createProject().device, laserArcMoves: 'off' as const };
    const text = serializeMachineProfileDocument({
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile,
      source: { kind: 'custom', label: 'Arcs off' },
      reviewNotes: [],
    });
    const loaded = deserializeMachineProfileDocument(text);
    if (loaded.kind !== 'ok') throw new Error('expected the profile to load');
    expect(loaded.document.profile.laserArcMoves).toBe('off');
  });
});
