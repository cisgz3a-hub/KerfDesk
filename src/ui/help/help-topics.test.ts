import { describe, expect, it } from 'vitest';
import { COMMAND_HELP, CONTROL_HELP, TOOL_HELP, controlHelp, helpProps } from './help-topics';
import {
  buildAppCommands,
  COMMAND_FAMILY_ORDER,
  type CommandId,
} from '../commands/command-registry';
import { baseCtx } from '../commands/command-registry-test-helpers';

describe('help topics', () => {
  it('keeps command help coverage aligned with the real command registry', () => {
    const registryIds = commandIds();
    const registryIdSet = new Set(registryIds);
    const missing = registryIds.filter((id) => COMMAND_HELP[id] === undefined);
    const stale = Object.keys(COMMAND_HELP).filter((id) => !registryIdSet.has(id as CommandId));

    expect(missing).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('defines meaningful help for every command id', () => {
    const weak = commandIds().filter((id) => !isMeaningful(COMMAND_HELP[id]?.tooltip ?? ''));

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
      'laser.detected-settings.review',
      'laser.detected-settings.dismiss',
      'laser.detected-settings.apply-safe',
      'laser.detected-settings.powered-z',
      'laser.machine-settings',
      'laser.machine-settings.read',
      'laser.machine-settings.export',
      'laser.machine-settings.table',
      'laser.machine-setup.tab.overview',
      'laser.machine-setup.tab.catalog',
      'laser.machine-setup.tab.controller',
      'laser.machine-setup.tab.firmware',
      'laser.machine-setup.tab.zones',
      'laser.machine-setup.tab.raster-diagnostics',
      'laser.machine-setup.tab.import-export',
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

function commandIds(): ReadonlyArray<CommandId> {
  return buildAppCommands(baseCtx()).map((command) => command.id);
}
