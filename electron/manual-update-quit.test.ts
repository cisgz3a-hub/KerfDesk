// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createManualCloseApproval, installManualUpdateQuit } from './manual-update-quit.js';
import type { ManualUpdates } from './manual-update.js';

function harness() {
  const events = new EventEmitter();
  const quit = vi.fn(() => {
    events.emit('will-quit', { preventDefault: vi.fn() });
  });
  const app = Object.assign(events, { quit, relaunch: vi.fn() });
  const updates = {
    status: () => ({ installOnQuit: true }),
    prepareInstall: vi.fn(async (): Promise<string | null> => 'C:\\verified\\installer.exe'),
  };
  const canInstall = vi.fn(() => true);
  installManualUpdateQuit(app, updates as unknown as ManualUpdates, { canInstall });
  const event = { preventDefault: vi.fn() };
  return { app, updates, canInstall, event, attempt: () => app.emit('will-quit', event) };
}
describe('manual installation after natural close', () => {
  it('a stalled verifier cannot keep an already closed application alive', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      let complete: (value: string) => void = () => undefined;
      h.updates.prepareInstall.mockImplementation(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      h.attempt();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(h.app.quit).toHaveBeenCalledOnce();
      complete('C:\\late\\installer.exe');
      await Promise.resolve();
      expect(h.app.relaunch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('never initiates quit; revalidates before registering post-exit interactive installer', async () => {
    const h = harness();
    expect(h.app.quit).not.toHaveBeenCalled();
    expect(h.app.relaunch).not.toHaveBeenCalled();
    h.attempt();
    expect(h.event.preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(h.app.quit).toHaveBeenCalledOnce());
    expect(h.updates.prepareInstall).toHaveBeenCalledOnce();
    expect(h.app.relaunch).toHaveBeenCalledExactlyOnceWith({
      execPath: 'C:\\verified\\installer.exe',
      args: [],
    });
  });
  it('ignores unapproved/forced close and leaves normal quit untouched', () => {
    const h = harness();
    h.canInstall.mockReturnValue(false);
    h.attempt();
    expect(h.event.preventDefault).not.toHaveBeenCalled();
    expect(h.updates.prepareInstall).not.toHaveBeenCalled();
  });
  it.each(['null', 'reject', 'session-end'])(
    'still quits without installing on %s',
    async (failure) => {
      const h = harness();
      if (failure === 'null') h.updates.prepareInstall.mockResolvedValue(null);
      if (failure === 'reject')
        h.updates.prepareInstall.mockRejectedValue(new Error('disk changed'));
      h.attempt();
      if (failure === 'session-end') h.canInstall.mockReturnValue(false);
      await vi.waitFor(() => expect(h.app.quit).toHaveBeenCalledOnce());
      expect(h.app.relaunch).not.toHaveBeenCalled();
    },
  );
  it('requires approved closed window and vetoes all session-end routes', () => {
    for (const event of ['query-session-end', 'session-end']) {
      const permission = createManualCloseApproval();
      const window = new EventEmitter();
      let closed = false;
      permission.observe(window, { wasClosedWithApproval: () => closed });
      expect(permission.canInstall()).toBe(false);
      closed = true;
      expect(permission.canInstall()).toBe(true);
      window.emit(event);
      expect(permission.canInstall()).toBe(false);
    }
  });
});
