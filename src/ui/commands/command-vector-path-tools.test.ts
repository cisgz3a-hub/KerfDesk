import { describe, expect, it, vi } from 'vitest';
import { buildAppCommands, commandById, runCommand } from './command-registry';
import { baseCtx } from './command-registry-test-helpers';

describe('vector path tool commands', () => {
  it('gates and invokes Convert to Path from vector path selection state', () => {
    const convertSelectionToPath = vi.fn();
    const disabled = buildAppCommands(
      baseCtx({ canConvertSelectionToPath: false, convertSelectionToPath }),
    );

    expect(commandById(disabled, 'tools.convert-to-path').enabled).toBe(false);
    expect(runCommand(commandById(disabled, 'tools.convert-to-path'))).toBe(false);
    expect(convertSelectionToPath).not.toHaveBeenCalled();

    const enabled = buildAppCommands(
      baseCtx({ canConvertSelectionToPath: true, convertSelectionToPath }),
    );
    expect(commandById(enabled, 'tools.convert-to-path').enabled).toBe(true);
    expect(runCommand(commandById(enabled, 'tools.convert-to-path'))).toBe(true);
    expect(convertSelectionToPath).toHaveBeenCalledTimes(1);
  });

  it('gates and invokes Weld from closed vector selection state', () => {
    const weldSelection = vi.fn();
    const disabled = buildAppCommands(baseCtx({ canWeldSelection: false, weldSelection }));

    expect(commandById(disabled, 'tools.weld').enabled).toBe(false);
    expect(runCommand(commandById(disabled, 'tools.weld'))).toBe(false);
    expect(weldSelection).not.toHaveBeenCalled();

    const enabled = buildAppCommands(baseCtx({ canWeldSelection: true, weldSelection }));
    expect(commandById(enabled, 'tools.weld').enabled).toBe(true);
    expect(runCommand(commandById(enabled, 'tools.weld'))).toBe(true);
    expect(weldSelection).toHaveBeenCalledTimes(1);
  });

  it('gates and invokes Subtract / Intersect / Exclude from combine selection state', () => {
    const subtractSelection = vi.fn();
    const intersectSelection = vi.fn();
    const excludeSelection = vi.fn();
    const disabled = buildAppCommands(
      baseCtx({
        canCombineSelection: false,
        subtractSelection,
        intersectSelection,
        excludeSelection,
      }),
    );
    for (const id of ['tools.subtract', 'tools.intersect', 'tools.exclude'] as const) {
      expect(commandById(disabled, id).enabled).toBe(false);
      expect(runCommand(commandById(disabled, id))).toBe(false);
    }

    const enabled = buildAppCommands(
      baseCtx({
        canCombineSelection: true,
        subtractSelection,
        intersectSelection,
        excludeSelection,
      }),
    );
    for (const id of ['tools.subtract', 'tools.intersect', 'tools.exclude'] as const) {
      expect(commandById(enabled, id).enabled).toBe(true);
      expect(runCommand(commandById(enabled, id))).toBe(true);
    }
    expect(subtractSelection).toHaveBeenCalledTimes(1);
    expect(intersectSelection).toHaveBeenCalledTimes(1);
    expect(excludeSelection).toHaveBeenCalledTimes(1);
  });
});
