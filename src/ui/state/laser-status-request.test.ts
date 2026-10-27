// A caller waiting for the work offset asks for a complete report where the
// driver has one (grblHAL 0x87, protocol audit P-4, ADR-674); every other
// driver sends nothing extra, and an ordinary request sends the plain query.

import { describe, expect, it, vi } from 'vitest';
import { grblDriver, grblHalDriver } from '../../core/controllers';
import type { ControllerDriver } from '../../core/controllers';
import { initialLaserState } from './laser-store-helpers';
import type { LaserState } from './laser-store';
import { sendCompleteStatusRequest, statusRequestActions } from './laser-status-request';

function sent(driver: ControllerDriver, complete: boolean) {
  const write = vi.fn(async (_line: string) => undefined);
  const state = initialLaserState() as LaserState;
  const actions = statusRequestActions(() => state, { driver }, write);
  const request = complete
    ? actions.requestCompleteControllerStatus()
    : actions.requestControllerStatus();
  return request.then(() => write.mock.calls.map((call) => call[0]));
}

describe('status requests', () => {
  it('sends 0x87 on grblHAL when a complete report is asked for', async () => {
    await expect(sent(grblHalDriver, true)).resolves.toEqual(['\x87']);
  });

  it('sends nothing extra for a complete report on stock GRBL', async () => {
    await expect(sent(grblDriver, true)).resolves.toEqual([]);
  });

  it('sends the ordinary query for an ordinary request', async () => {
    await expect(sent(grblHalDriver, false)).resolves.toEqual(['?']);
    await expect(sent(grblDriver, false)).resolves.toEqual(['?']);
  });
});

describe('sendCompleteStatusRequest', () => {
  const idle = initialLaserState() as LaserState;

  it('sends 0x87 once on grblHAL and nothing on stock GRBL', async () => {
    const write = vi.fn(async () => undefined);
    await sendCompleteStatusRequest(() => idle, grblHalDriver, write);
    await sendCompleteStatusRequest(() => idle, grblDriver, write);
    expect(write.mock.calls).toEqual([['\x87', undefined, 'system']]);
  });

  it('stays silent while a settings read owns polling', async () => {
    const write = vi.fn(async () => undefined);
    const reading = {
      ...idle,
      controllerOperation: { kind: 'interactive-command', pollingOwnership: 'terminal-exchange' },
    } as unknown as LaserState;
    await sendCompleteStatusRequest(() => reading, grblHalDriver, write);
    expect(write).not.toHaveBeenCalled();
  });

  it('swallows a failed write', async () => {
    const write = vi.fn(async () => {
      throw new Error('port closed');
    });
    await expect(
      sendCompleteStatusRequest(() => idle, grblHalDriver, write),
    ).resolves.toBeUndefined();
  });
});
