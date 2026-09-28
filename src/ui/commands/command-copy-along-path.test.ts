import { describe, expect, it, vi } from 'vitest';
import { isRegisteredHelpTopicId } from '../help/help-topics';
import { buildAppCommands, commandById, runCommand } from './command-registry';
import { baseCtx } from './command-registry-test-helpers';

describe('Copy Along Path command (LBG-T09)', () => {
  it('sits in the Arrange menu right after Array and opens the dialog', () => {
    const copyAlongPath = vi.fn();
    const commands = buildAppCommands(baseCtx({ hasSelection: true, copyAlongPath }));
    const ids = commands.map((command) => command.id);
    const command = commandById(commands, 'arrange.copy-along-path');

    expect(ids.indexOf('arrange.copy-along-path')).toBe(ids.indexOf('arrange.array') + 1);
    expect(command).toMatchObject({
      family: 'arrange',
      label: 'Copy Along Path...',
      enabled: true,
    });
    expect(runCommand(command)).toBe(true);
    expect(copyAlongPath).toHaveBeenCalledExactlyOnceWith();
  });

  it('explains what to select when nothing is selected', () => {
    const copyAlongPath = vi.fn();
    const command = commandById(
      buildAppCommands(baseCtx({ hasSelection: false, copyAlongPath })),
      'arrange.copy-along-path',
    );

    expect(command.enabled).toBe(false);
    expect(command.disabledReason).toBe('Select the artwork and a guide path first.');
    expect(runCommand(command)).toBe(false);
    expect(copyAlongPath).not.toHaveBeenCalled();
  });

  it('has registered hover help', () => {
    expect(isRegisteredHelpTopicId('command:arrange.copy-along-path')).toBe(true);
  });
});
