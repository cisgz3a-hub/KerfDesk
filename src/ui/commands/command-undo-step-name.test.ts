import { describe, expect, it, vi } from 'vitest';
import { createProject, type Project } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { pushUndo } from '../state/scene-mutations';
import { undoStepName } from '../state/undo-step-names';
import { enabled, type AppCommand, type CommandId } from './command-types';
import { runCommand } from './command-registry';
import { commandUndoStepName } from './command-undo-step-name';

function command(id: CommandId, label: string, invoke: () => void = vi.fn()): AppCommand {
  return enabled(id, 'edit', label, label, invoke);
}

function withRectangle(base: Project): Project {
  const rect = createRectangle({
    id: 'a',
    color: '#000000',
    spec: { widthMm: 5, heightMm: 5, cornerRadiusMm: 0 },
  });
  return { ...base, scene: { ...base.scene, objects: [rect] } };
}

describe('command undo step names', () => {
  it('uses the menu label without its trailing ellipsis', () => {
    expect(commandUndoStepName(command('arrange.align-left', 'Align Left'))).toBe('Align Left');
    expect(commandUndoStepName(command('arrange.array', 'Array...'))).toBe('Array');
    expect(commandUndoStepName(command('arrange.array', 'Array…'))).toBe('Array');
  });

  it('lets Delete describe what it removed', () => {
    expect(commandUndoStepName(command('edit.delete', 'Delete'))).toBeNull();
  });

  it('runCommand names the step its command pushes', () => {
    const before = createProject();
    runCommand(command('arrange.align-top', 'Align Top', () => void pushUndo(before, [])));
    expect(undoStepName(before, withRectangle(before))).toBe('Align Top');

    const deleted = withRectangle(createProject());
    runCommand(command('edit.delete', 'Delete', () => void pushUndo(deleted, [])));
    expect(undoStepName(deleted, createProject())).toBe('Delete rectangle');
  });
});
