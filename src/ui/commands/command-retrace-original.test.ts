import { describe, expect, it, vi } from 'vitest';
import { buildAppCommands, commandById, runCommand } from './command-registry';
import { baseCtx } from './command-registry-test-helpers';

describe('Re-trace Original command', () => {
  it('is disabled unless the selected trace still has its source raster', () => {
    const retraceOriginal = vi.fn();
    const command = commandById(
      buildAppCommands(baseCtx({ canRetraceOriginal: false, retraceOriginal })),
      'tools.retrace-original',
    );

    expect(command.enabled).toBe(false);
    expect(runCommand(command)).toBe(false);
    expect(retraceOriginal).not.toHaveBeenCalled();
  });

  it('runs the retrace action when the original raster is available', () => {
    const retraceOriginal = vi.fn();
    const command = commandById(
      buildAppCommands(baseCtx({ canRetraceOriginal: true, retraceOriginal })),
      'tools.retrace-original',
    );

    expect(command.enabled).toBe(true);
    expect(runCommand(command)).toBe(true);
    expect(retraceOriginal).toHaveBeenCalledTimes(1);
  });
});
