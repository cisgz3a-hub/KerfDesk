import { describe, expect, it } from 'vitest';
import { createProject, type Project } from '../../core/scene';
import { deserializeProject, deserializeProjectValue } from './deserialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { serializeProject } from './serialize-project';

describe('registration artwork output intent persistence', () => {
  it('roundtrips enabled and disabled operations while the outline is output', () => {
    const registrationArtworkOutputSnapshot = { artwork: true, disabled: false };
    const project = { ...createProject(), registrationArtworkOutputSnapshot };
    expect(prepareProjectForPersistence(project).kind).toBe('ok');
    const loaded = deserializeProject(serializeProject(project));
    expect(loaded.kind).toBe('ok');
    if (loaded.kind === 'ok') {
      expect(loaded.project.registrationArtworkOutputSnapshot).toEqual(
        registrationArtworkOutputSnapshot,
      );
    }
  });

  it('keeps old projects without a saved output intention unchanged', () => {
    const loaded = deserializeProject(serializeProject(createProject()));
    expect(loaded.kind).toBe('ok');
    if (loaded.kind === 'ok')
      expect(loaded.project).not.toHaveProperty('registrationArtworkOutputSnapshot');
  });

  it.each([null, [], 'true', { artwork: 'false' }, { artwork: 1 }])(
    'drops malformed optional output intent when opening: %j',
    (registrationArtworkOutputSnapshot) => {
      const loaded = deserializeProjectValue({
        ...createProject(),
        registrationArtworkOutputSnapshot,
      });
      expect(loaded.kind).toBe('ok');
      if (loaded.kind === 'ok')
        expect(loaded.project).not.toHaveProperty('registrationArtworkOutputSnapshot');
    },
  );

  it('refuses a save that would silently alter restoration intent', () => {
    const prepared = prepareProjectForPersistence({
      ...createProject(),
      registrationArtworkOutputSnapshot: { artwork: 'false' },
    } as unknown as Project);
    expect(prepared.kind).toBe('invalid');
    if (prepared.kind === 'invalid')
      expect(prepared.reason).toContain('registrationArtworkOutputSnapshot');
  });
});
