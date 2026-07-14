import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, type Project } from '../../core/scene';
import { readAutosave, writeAutosave } from './autosave';

beforeEach(() => localStorage.clear());

describe('autosave project validation', () => {
  it('rejects invalid live project state without writing a recovery slot', () => {
    const project = {
      ...createProject(),
      workspace: { ...createProject().workspace, width: Number.NaN },
    } as Project;

    expect(writeAutosave(project)).toMatchObject({
      kind: 'failed',
      reason: 'invalid-project',
    });
    expect(readAutosave()).toBeNull();
  });
});
