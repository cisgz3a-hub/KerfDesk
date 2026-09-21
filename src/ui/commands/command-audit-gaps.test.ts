import { describe, expect, it, vi } from 'vitest';
import { buildAppCommands, commandById, runCommand } from './command-registry';
import type { AppCommandContext, CommandId } from './command-types';
import { baseCtx } from './command-registry-test-helpers';

type CommandCase = {
  readonly id: CommandId;
  readonly callback: keyof AppCommandContext;
  readonly args?: readonly string[];
};

// These command IDs had no explicit test reference when the September button
// audit was generated. Assert the intended action and argument, independently
// of the registry's generic enabled/disabled constructors.
const CASES: readonly CommandCase[] = [
  { id: 'file.open-gcode', callback: 'openGcodePreview' },
  { id: 'edit.redo', callback: 'redo' },
  { id: 'edit.select-all', callback: 'selectAll' },
  { id: 'edit.clear-selection', callback: 'clearSelection' },
  { id: 'tools.box-fit-test', callback: 'boxFitTest' },
  { id: 'tools.print-and-cut', callback: 'printAndCut' },
  { id: 'tools.labs', callback: 'labsSettings' },
  { id: 'arrange.align-center-x', callback: 'alignSelection', args: ['center-x'] },
  { id: 'arrange.align-right', callback: 'alignSelection', args: ['right'] },
  { id: 'arrange.align-top', callback: 'alignSelection', args: ['top'] },
  { id: 'arrange.align-center-y', callback: 'alignSelection', args: ['center-y'] },
  { id: 'arrange.align-bottom', callback: 'alignSelection', args: ['bottom'] },
  { id: 'arrange.align-centers', callback: 'alignSelection', args: ['centers'] },
  {
    id: 'arrange.distribute-horizontal-spacing',
    callback: 'distributeSelection',
    args: ['horizontal-spacing'],
  },
  {
    id: 'arrange.distribute-vertical-centers',
    callback: 'distributeSelection',
    args: ['vertical-centers'],
  },
  {
    id: 'arrange.distribute-vertical-spacing',
    callback: 'distributeSelection',
    args: ['vertical-spacing'],
  },
  { id: 'arrange.array', callback: 'createArray' },
  { id: 'arrange.quick-nest', callback: 'quickNest' },
  { id: 'arrange.flip-vertical', callback: 'flipVertical' },
  { id: 'laser.disconnect', callback: 'disconnectLaser' },
  { id: 'help.connection', callback: 'showConnectionHelp' },
  { id: 'help.safety', callback: 'showSafety' },
];

function availableContext(overrides: Partial<AppCommandContext> = {}): AppCommandContext {
  return baseCtx({
    connected: true,
    canRedo: true,
    hasSelection: true,
    canAlignSelection: true,
    canDistributeSelection: true,
    canTransformSelection: true,
    printAndCutFeatureEnabled: true,
    printAndCutProfileSupported: true,
    ...overrides,
  });
}

describe('command audit callback gaps', () => {
  it.each(CASES)('$id dispatches its documented action once', ({ id, callback, args }) => {
    const invoke = vi.fn();
    const command = commandById(buildAppCommands(availableContext({ [callback]: invoke })), id);
    expect(command.enabled).toBe(true);
    expect(runCommand(command)).toBe(true);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(...(args ?? []));
  });

  it.each([
    { id: 'edit.redo', callback: 'redo', overrides: { canRedo: false } },
    { id: 'arrange.array', callback: 'createArray', overrides: { hasSelection: false } },
    { id: 'arrange.quick-nest', callback: 'quickNest', overrides: { hasSelection: false } },
    {
      id: 'arrange.flip-vertical',
      callback: 'flipVertical',
      overrides: { canTransformSelection: false },
    },
    { id: 'laser.disconnect', callback: 'disconnectLaser', overrides: { connected: false } },
    { id: 'laser.disconnect', callback: 'disconnectLaser', overrides: { machineBusy: true } },
    {
      id: 'tools.print-and-cut',
      callback: 'printAndCut',
      overrides: { printAndCutFeatureEnabled: false },
    },
    {
      id: 'tools.print-and-cut',
      callback: 'printAndCut',
      overrides: { printAndCutProfileSupported: false },
    },
  ] as const)(
    '$id explains its unavailable state without invoking',
    ({ id, callback, overrides }) => {
      const invoke = vi.fn();
      const command = commandById(
        buildAppCommands(availableContext({ ...overrides, [callback]: invoke })),
        id,
      );
      expect(command.enabled).toBe(false);
      expect(command.disabledReason).toBeTruthy();
      expect(runCommand(command)).toBe(false);
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it.each(CASES.filter((entry) => entry.args !== undefined))(
    '$id waits for an eligible selection',
    ({ id, callback }) => {
      const invoke = vi.fn();
      const command = commandById(
        buildAppCommands(
          availableContext({
            canAlignSelection: false,
            canDistributeSelection: false,
            [callback]: invoke,
          }),
        ),
        id,
      );
      expect(command.enabled).toBe(false);
      expect(command.disabledReason).toContain('Select at least');
      expect(runCommand(command)).toBe(false);
      expect(invoke).not.toHaveBeenCalled();
    },
  );
});
