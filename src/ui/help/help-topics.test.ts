import { describe, expect, it } from 'vitest';
import { COMMAND_HELP, CONTROL_HELP, TOOL_HELP, controlHelp, helpProps } from './help-topics';
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
  'edit.copy',
  'edit.cut',
  'edit.paste',
  'edit.group',
  'edit.ungroup',
  'edit.lock-selection',
  'edit.unlock-all',
  'edit.duplicate',
  'edit.delete',
  'edit.clear-selection',
  'tools.measure',
  'tools.add-text',
  'tools.material-test',
  'tools.interval-test',
  'tools.scan-offset-test',
  'tools.optimization-settings',
  'tools.adjust-image',
  'tools.apply-image-mask',
  'tools.crop-image',
  'tools.remove-image-mask',
  'tools.save-processed-bitmap',
  'tools.trace-image',
  'tools.multi-file-trace',
  'tools.convert-to-bitmap',
  'tools.fill-selection',
  'tools.close-open-fill-contours',
  'tools.close-fill-contours-with-tolerance',
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
  'arrange.break-apart',
  'arrange.flip-horizontal',
  'arrange.flip-vertical',
  'laser.connect',
  'laser.disconnect',
  'laser.home',
  'window.toggle-preview',
  'window.fit-view',
  'window.project-notes',
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
    expect(TOOL_HELP.node.tooltip.toLowerCase()).toContain('nodes');
    expect(TOOL_HELP.rect.tooltip).toContain('rectangle');
    expect(TOOL_HELP.star.tooltip).toContain('star');
    expect(TOOL_HELP.polyline.tooltip).toContain('Enter');
  });

  it('returns title and data-help-id props for registered controls', () => {
    expect(helpProps('command:file.import-image')).toEqual({
      title: COMMAND_HELP['file.import-image'].tooltip,
      'data-help-id': 'command:file.import-image',
    });
  });

  it('defines meaningful help for the GRBL console controls', () => {
    const controlIds = [
      'laser.console',
      'laser.console.copy',
      'laser.console.clear',
      'laser.console.input',
      'laser.console.send',
      'laser.console.quick.$X',
      'laser.console.quick.$$',
      'laser.console.quick.$#',
      'laser.console.quick.$I',
      'laser.console.quick.$G',
      'laser.console.quick.?',
      'laser.machine-settings',
      'laser.machine-settings.read',
      'laser.machine-settings.export',
      'laser.machine-settings.table',
      'laser.output-scope.cut-selected',
      'laser.output-scope.selection-origin',
    ] as const;

    const missing = controlIds.filter((id) => CONTROL_HELP[id] === undefined);
    const weak = controlIds.filter((id) => !isMeaningful(CONTROL_HELP[id]?.tooltip ?? ''));

    expect(missing).toEqual([]);
    expect(weak).toEqual([]);
  });

  it('keeps disabled reasons first while preserving the normal explanation', () => {
    const title = controlHelp('command:tools.trace-image', 'Select an image first.');

    expect(title.startsWith('Select an image first.')).toBe(true);
    expect(title).toContain(COMMAND_HELP['tools.trace-image'].tooltip);
  });

  it('resolves registered control help by id', () => {
    expect(controlHelp('control:laser.console.quick.$I')).toBe(
      CONTROL_HELP['laser.console.quick.$I'].tooltip,
    );
  });
});

function isMeaningful(value: string): boolean {
  return value.length >= 18 && /\s/.test(value) && /[.!?]$/.test(value);
}
