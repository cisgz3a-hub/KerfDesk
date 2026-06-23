import { describe, expect, it, vi } from 'vitest';
import { buildAppCommands, commandById, runCommand } from './command-registry';
import { baseCtx } from './command-registry-test-helpers';

describe('arrange.break-apart command', () => {
  it('is gated from break-apart selection state', () => {
    const breakApartSelection = vi.fn();
    const disabled = buildAppCommands(
      baseCtx({ canBreakApartSelection: false, breakApartSelection }),
    );

    expect(commandById(disabled, 'arrange.break-apart').enabled).toBe(false);
    expect(runCommand(commandById(disabled, 'arrange.break-apart'))).toBe(false);
    expect(breakApartSelection).not.toHaveBeenCalled();

    const enabled = buildAppCommands(
      baseCtx({ canBreakApartSelection: true, breakApartSelection }),
    );
    expect(commandById(enabled, 'arrange.break-apart').enabled).toBe(true);
    expect(runCommand(commandById(enabled, 'arrange.break-apart'))).toBe(true);
    expect(breakApartSelection).toHaveBeenCalledTimes(1);
  });
});
