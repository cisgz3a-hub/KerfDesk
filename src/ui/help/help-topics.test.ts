import { describe, expect, it } from 'vitest';
import { COMMAND_HELP, TOOL_HELP, controlHelp, helpProps } from './help-topics';
import { COMMAND_FAMILY_ORDER, type CommandId } from '../commands/command-registry';

const COMMAND_IDS: ReadonlyArray<CommandId> = [
  'file.new',
  'file.open',
  'file.save',
  'file.save-as',
  'file.import-svg',
  'file.import-image',
  'file.save-gcode',
  'edit.undo',
  'edit.redo',
  'edit.select-all',
  'edit.duplicate',
  'edit.delete',
  'edit.clear-selection',
  'tools.add-text',
  'tools.material-test',
  'tools.interval-test',
  'tools.optimization-settings',
  'tools.adjust-image',
  'tools.trace-image',
  'tools.convert-to-bitmap',
  'arrange.align-left',
  'arrange.align-center-x',
  'arrange.align-right',
  'arrange.align-top',
  'arrange.align-center-y',
  'arrange.align-bottom',
  'arrange.align-centers',
  'arrange.distribute-horizontal-centers',
  'arrange.distribute-horizontal-spacing',
  'arrange.distribute-vertical-centers',
  'arrange.distribute-vertical-spacing',
  'arrange.flip-horizontal',
  'arrange.flip-vertical',
  'laser.connect',
  'laser.disconnect',
  'laser.home',
  'window.toggle-preview',
  'window.fit-view',
  'help.about',
];

describe('help topics', () => {
  it('defines meaningful help for every command id', () => {
    const missing = COMMAND_IDS.filter((id) => COMMAND_HELP[id] === undefined);
    const weak = COMMAND_IDS.filter((id) => !isMeaningful(COMMAND_HELP[id]?.tooltip ?? ''));

    expect(missing).toEqual([]);
    expect(weak).toEqual([]);
  });

  it('keeps command help families aligned with the command menu families', () => {
    const families = new Set(Object.values(COMMAND_HELP).map((topic) => topic.family));

    expect([...families]).toEqual(expect.arrayContaining([...COMMAND_FAMILY_ORDER]));
  });

  it('defines drawing-tool help separate from icon labels', () => {
    expect(TOOL_HELP.select.tooltip.toLowerCase()).toContain('select');
    expect(TOOL_HELP.rect.tooltip).toContain('rectangle');
    expect(TOOL_HELP.polyline.tooltip).toContain('Enter');
  });

  it('returns title and data-help-id props for registered controls', () => {
    expect(helpProps('command:file.import-image')).toEqual({
      title: COMMAND_HELP['file.import-image'].tooltip,
      'data-help-id': 'command:file.import-image',
    });
  });

  it('keeps disabled reasons first while preserving the normal explanation', () => {
    const title = controlHelp('command:tools.trace-image', 'Select an image first.');

    expect(title.startsWith('Select an image first.')).toBe(true);
    expect(title).toContain(COMMAND_HELP['tools.trace-image'].tooltip);
  });
});

function isMeaningful(value: string): boolean {
  return value.length >= 18 && /\s/.test(value) && /[.!?]$/.test(value);
}
