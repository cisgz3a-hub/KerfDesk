import { describe, expect, it } from 'vitest';
import { buildAppCommands } from './command-registry';
import { baseCtx } from './command-registry-test-helpers';
import { searchCommands } from './command-search';
import { disabled, enabled, type AppCommand } from './command-types';

const noop = (): void => undefined;
const family = (command: AppCommand): string => command.family;

const COMMANDS: ReadonlyArray<AppCommand> = [
  enabled('file.save', 'file', 'Save', 'Save the project', noop, 'Ctrl+S'),
  enabled('file.save-as', 'file', 'Save As...', 'Save under a new name', noop),
  enabled('file.save-gcode', 'file', 'Save G-code...', 'Export G-code', noop),
  enabled('edit.duplicate', 'edit', 'Duplicate', 'Duplicate the selection', noop),
  disabled('edit.group', 'edit', 'Group', 'Select two or more objects to group.', noop),
  enabled('tools.box-generator', 'tools', 'Box Generator...', 'Make a box', noop),
];

function ids(query: string, commands: ReadonlyArray<AppCommand> = COMMANDS): string[] {
  return searchCommands(commands, query, family).map((result) => result.command.id);
}

describe('searchCommands', () => {
  it('lists every command in menu order when nothing is typed', () => {
    expect(ids('   ')).toEqual(COMMANDS.map((command) => command.id));
  });

  it('ranks a label that starts with the words above one that only contains them', () => {
    expect(ids('save')).toEqual(['file.save', 'file.save-as', 'file.save-gcode']);
    expect(ids('save as')[0]).toBe('file.save-as');
  });

  it('requires every typed word to match', () => {
    expect(ids('save box')).toEqual([]);
  });

  it('ignores case, punctuation and the spaces inside a label', () => {
    expect(ids('G-CODE')).toEqual(['file.save-gcode']);
    expect(ids('gcode')).toEqual(['file.save-gcode']);
    expect(ids('boxgen')).toEqual(['tools.box-generator']);
  });

  it('matches letters typed in order for longer queries', () => {
    expect(ids('bxgnr')).toEqual(['tools.box-generator']);
  });

  it('finds commands by their help tooltip and menu name', () => {
    // The registered tooltip, not the fallback title, is what is searched.
    expect(ids('finger')).toContain('tools.box-generator');
    expect(ids('tools')).toEqual(['tools.box-generator']);
  });

  it('keeps disabled commands, below an equally good enabled one', () => {
    const commands = [
      disabled('edit.group', 'edit', 'Group shapes', 'Select two or more objects to group.', noop),
      enabled('edit.ungroup', 'edit', 'Group layers', 'Ungroup', noop),
    ];
    expect(ids('group', commands)).toEqual(['edit.ungroup', 'edit.group']);
  });
});

describe('searchCommands over the real registry', () => {
  const commands = buildAppCommands(baseCtx());
  const top = (query: string): string | undefined =>
    searchCommands(commands, query, family)[0]?.command.id;

  it.each([
    ['box', 'tools.box-generator'],
    ['undo', 'edit.undo'],
    ['find', 'help.find-command'],
    ['save gcode', 'file.save-gcode'],
  ])('puts the expected command first for "%s"', (query, expected) => {
    expect(top(query)).toBe(expected);
  });

  it('offers Find a command from the Help menu with its shortcut', () => {
    const command = commands.find((candidate) => candidate.id === 'help.find-command');
    expect(command).toMatchObject({ family: 'help', enabled: true, shortcut: 'Ctrl+K' });
  });
});
