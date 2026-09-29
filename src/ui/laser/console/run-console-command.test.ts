import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../../core/controllers';
import { jobAwareConfirm } from '../../state/job-aware-dialogs';
import { runConsoleCommand } from './run-console-command';

vi.mock('../../state/job-aware-dialogs', () => ({ jobAwareConfirm: vi.fn() }));

describe('runConsoleCommand', () => {
  beforeEach(() => {
    vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
  });

  it('confirms persistent setting writes and marks the store call confirmed', async () => {
    const send = vi.fn(async () => undefined);

    await expect(runConsoleCommand(grblDriver, '  $32=1  ', send)).resolves.toEqual({
      status: 'sent',
      command: '$32=1',
    });
    expect(jobAwareConfirm).toHaveBeenCalledWith('Send persistent controller setting?\n\n$32=1');
    expect(send).toHaveBeenCalledWith('$32=1', { confirmed: true });
  });

  it('does not call the store when confirmation is declined', async () => {
    vi.mocked(jobAwareConfirm).mockReturnValue(false);
    const send = vi.fn(async () => undefined);

    await expect(runConsoleCommand(grblDriver, '$120=250', send)).resolves.toEqual({
      status: 'cancelled',
      command: '$120=250',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('carries saved macro provenance through the same store call', async () => {
    const send = vi.fn(async () => undefined);
    const provenance = {
      kind: 'user-macro' as const,
      macroName: 'Nudge X',
      macroTemplate: 'G0 X{{distance}}',
    };

    await expect(runConsoleCommand(grblDriver, 'G0 X2.5', send, provenance)).resolves.toEqual({
      status: 'sent',
      command: 'G0 X2.5',
    });
    expect(send).toHaveBeenCalledWith('G0 X2.5', { provenance });
  });

  it('keeps the existing persistent-setting confirmation for a saved macro', async () => {
    const send = vi.fn(async () => undefined);
    const provenance = {
      kind: 'user-macro' as const,
      macroName: 'Set acceleration',
      macroTemplate: '$120={{value}}',
    };

    await expect(runConsoleCommand(grblDriver, '$120=250', send, provenance)).resolves.toEqual({
      status: 'sent',
      command: '$120=250',
    });
    expect(jobAwareConfirm).toHaveBeenCalledWith('Send persistent controller setting?\n\n$120=250');
    expect(send).toHaveBeenCalledWith('$120=250', { confirmed: true, provenance });
  });

  // Controller audit 2 (ADR-375), C-4: stock GRBL would store 0.5 as 0 and turn
  // homing and soft limits off (grbl/settings.c#L229, #L275-L280), so the value
  // is refused before the operator is asked to confirm it.
  it('refuses a setting value the Console will not send before asking to confirm it', async () => {
    const send = vi.fn(async () => undefined);

    await expect(runConsoleCommand(grblDriver, '$22=0.5', send)).resolves.toEqual({
      status: 'rejected',
      command: '$22=0.5',
      reason:
        '$22 is an on/off setting: enter 0 or 1. GRBL drops the fraction, so 0.5 would turn it off.',
    });
    expect(jobAwareConfirm).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('returns validation and asynchronous store failures without throwing', async () => {
    const validationSend = vi.fn(async () => undefined);
    const invalid = await runConsoleCommand(grblDriver, 'G0 X0\nG0 Y0', validationSend);
    const rejected = await runConsoleCommand(grblDriver, '$$', async () => {
      throw new Error('A settings read is already in progress.');
    });

    expect(invalid.status).toBe('rejected');
    expect(validationSend).not.toHaveBeenCalled();
    expect(rejected).toEqual({
      status: 'rejected',
      command: '$$',
      reason: 'A settings read is already in progress.',
    });
  });
});
