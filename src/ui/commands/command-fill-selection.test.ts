import { describe, expect, it, vi } from 'vitest';
import { buildAppCommands, commandById, runCommand } from './command-registry';
import { baseCtx } from './command-registry-test-helpers';

describe('tools.fill-selection command', () => {
  it('is gated from vector selection state', () => {
    const fillSelectionSeparately = vi.fn();
    const disabled = buildAppCommands(
      baseCtx({ hasFillableSelection: false, fillSelectionSeparately }),
    );

    expect(commandById(disabled, 'tools.fill-selection').enabled).toBe(false);
    expect(runCommand(commandById(disabled, 'tools.fill-selection'))).toBe(false);
    expect(fillSelectionSeparately).not.toHaveBeenCalled();

    const enabled = buildAppCommands(
      baseCtx({ hasFillableSelection: true, fillSelectionSeparately }),
    );
    expect(commandById(enabled, 'tools.fill-selection').enabled).toBe(true);
    expect(runCommand(commandById(enabled, 'tools.fill-selection'))).toBe(true);
    expect(fillSelectionSeparately).toHaveBeenCalledTimes(1);
  });
});
