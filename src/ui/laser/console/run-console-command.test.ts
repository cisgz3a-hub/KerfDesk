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
