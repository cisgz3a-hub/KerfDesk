import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProject,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import {
  deserializeProject,
  prepareProjectForAutosave,
  prepareProjectForPersistence,
} from '../../io/project';
import { readAutosave, writeAutosave } from './autosave';

const POSITION_COUNT = 90_000;

function typedReliefProject(notes = ''): Project {
  const project = createProject();
  const relief: ReliefObject = {
    kind: 'relief',
    id: 'typed-relief',
    source: 'large.stl',
    meshPositions: new Float32Array(POSITION_COUNT).fill(1),
    targetWidthMm: 100,
    reliefDepthMm: 5,
    emptyCells: 'floor',
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
  };
  return { ...project, notes, scene: { ...project.scene, objects: [relief] } };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('large typed relief persistence', () => {
  it('manual save and autosave reopen with the same embedded mesh', () => {
    const project = typedReliefProject();
    const saved = prepareProjectForPersistence(project);
    const autosaved = prepareProjectForAutosave(project);

    expect(saved.kind).toBe('ok');
    expect(autosaved.kind).toBe('ok');
    if (saved.kind !== 'ok' || autosaved.kind !== 'ok') return;
    const reopenedSave = deserializeProject(saved.json);
    const reopenedAutosave = deserializeProject(autosaved.json);
    expect(reopenedSave.kind).toBe('ok');
    expect(reopenedAutosave.kind).toBe('ok');
    if (reopenedSave.kind !== 'ok' || reopenedAutosave.kind !== 'ok') return;
    expect(reopenedSave.project.scene.objects[0]).toEqual(
      reopenedAutosave.project.scene.objects[0],
    );
    expect(reopenedSave.project.scene.objects[0]?.kind).toBe('relief');
    expect(
      reopenedSave.project.scene.objects[0]?.kind === 'relief'
        ? reopenedSave.project.scene.objects[0].meshPositions
        : [],
    ).toHaveLength(POSITION_COUNT);
  });

  it('autosave recovery restores the typed live mesh as valid project JSON', () => {
    const result = writeAutosave(typedReliefProject('recover me'), 100, {
      sessionId: 'large-relief',
    });

    expect(result.kind).toBe('ok');
    expect(readAutosave()?.project.notes).toBe('recover me');
    const recovered = readAutosave()?.project.scene.objects[0];
    expect(recovered?.kind).toBe('relief');
    if (recovered?.kind !== 'relief') return;
    expect(recovered.meshPositions).toHaveLength(POSITION_COUNT);
  });

  it('quota pressure reports failure and preserves the prior recovery slot', () => {
    expect(
      writeAutosave(typedReliefProject('prior recovery'), 100, {
        sessionId: 'large-relief',
      }).kind,
    ).toBe('ok');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage full', 'QuotaExceededError');
    });

    const failed = writeAutosave(typedReliefProject('new recovery'), 200, {
      sessionId: 'large-relief',
    });
    vi.restoreAllMocks();

    expect(failed).toMatchObject({ kind: 'failed', reason: 'quota' });
    expect(readAutosave()?.project.notes).toBe('prior recovery');
  });
});
