import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { WindowCloseGuard } from './window-close-guard.js';

function harness() {
  const events = new EventEmitter();
  const webContents = new EventEmitter();
  const allowed = vi.fn();
  const window = Object.assign(events, {
    webContents,
    close: vi.fn(() => {
      const event = { preventDefault: vi.fn() };
      events.emit('close', event);
      if (event.preventDefault.mock.calls.length === 0) allowed();
    }),
  });
  let quitting = false;
  const options = {
    request: vi.fn(async (operation: string): Promise<unknown> => {
      if (operation === 'prepare') return { status: 'ready', dirty: false };
      return { status: operation === 'approve' ? 'approved' : 'cancelled' };
    }),
    decideUnsaved: vi.fn((): 'leave' | 'stay' => 'leave'),
    decideUnavailable: vi.fn((): 'leave' | 'stay' => 'stay'),
    forceClose: vi.fn(() => events.emit('closed')),
    isQuitRequested: () => quitting,
    cancelQuit: vi.fn(() => (quitting = false)),
    quit: vi.fn(() => window.close()),
    reportFailure: vi.fn(),
  };
  new WindowCloseGuard(window, options);
  return { window, options, allowed, requestQuit: () => (quitting = true) };
}

describe('ordinary desktop close and quit', () => {
  it('prevents teardown until delayed preparation and approval complete, joining repeats', async () => {
    const h = harness();
    let finish: (reply: unknown) => void = () => undefined;
    h.options.request.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    h.window.close();
    h.window.close();
    const unload = { preventDefault: vi.fn() };
    h.window.webContents.emit('will-prevent-unload', unload);
    expect(unload.preventDefault).not.toHaveBeenCalled();
    expect(h.options.decideUnsaved).not.toHaveBeenCalled();
    expect(h.options.request).toHaveBeenCalledTimes(1);
    expect(h.allowed).not.toHaveBeenCalled();
    finish({ status: 'ready', dirty: false });
    await vi.waitFor(() => expect(h.allowed).toHaveBeenCalledTimes(1));
    expect(h.options.request.mock.calls.map(([operation]) => operation)).toEqual([
      'prepare',
      'approve',
    ]);
  });

  it('retains dirty idle state on Stay, then permits a later Leave', async () => {
    const h = harness();
    h.options.request.mockImplementation(async (operation) => {
      if (operation === 'prepare') return { status: 'ready', dirty: true };
      return { status: operation === 'approve' ? 'approved' : 'cancelled' };
    });
    h.options.decideUnsaved.mockReturnValueOnce('stay');
    h.window.close();
    await vi.waitFor(() => expect(h.options.cancelQuit).toHaveBeenCalledTimes(1));
    expect(h.allowed).not.toHaveBeenCalled();
    h.window.close();
    await vi.waitFor(() => expect(h.allowed).toHaveBeenCalledTimes(1));
    expect(h.options.decideUnsaved).toHaveBeenCalledTimes(2);
  });

  it('retries app.quit after approval and clears quit intent if the operator keeps open', async () => {
    const h = harness();
    h.requestQuit();
    h.options.request.mockResolvedValueOnce({ status: 'cancelled' });
    h.window.close();
    await vi.waitFor(() => expect(h.options.cancelQuit).toHaveBeenCalledTimes(1));
    expect(h.options.quit).not.toHaveBeenCalled();
    h.requestQuit();
    h.window.close();
    await vi.waitFor(() => expect(h.options.quit).toHaveBeenCalledTimes(1));
    expect(h.allowed).toHaveBeenCalledTimes(1);
  });

  it('reprepares if the renderer invalidates approval before the actual unload', async () => {
    const h = harness();
    h.window.close();
    await vi.waitFor(() => expect(h.allowed).toHaveBeenCalledTimes(1));
    const event = { preventDefault: vi.fn() };
    h.window.webContents.emit('will-prevent-unload', event);
    await vi.waitFor(() => expect(h.allowed).toHaveBeenCalledTimes(2));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(h.options.decideUnsaved).not.toHaveBeenCalled();
    expect(
      h.options.request.mock.calls.filter(([operation]) => operation === 'prepare'),
    ).toHaveLength(2);
  });

  it('retains an unavailable or rejected renderer by default with a visible recovery decision', async () => {
    const h = harness();
    h.options.request.mockRejectedValueOnce(new Error('renderer exited'));
    h.window.close();
    await vi.waitFor(() => expect(h.options.decideUnavailable).toHaveBeenCalledTimes(1));
    expect(h.allowed).not.toHaveBeenCalled();
    expect(h.options.forceClose).not.toHaveBeenCalled();
    expect(h.options.reportFailure).toHaveBeenCalledTimes(1);
  });

  it('recovers from a renderer crash even if its pending prepare Promise never rejects', async () => {
    const h = harness();
    let finish: (reply: unknown) => void = () => undefined;
    h.options.request.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    h.window.close();
    h.window.webContents.emit('render-process-gone');
    await vi.waitFor(() => expect(h.options.decideUnavailable).toHaveBeenCalledTimes(1));
    finish({ status: 'ready', dirty: false });
    await Promise.resolve();
    expect(h.allowed).not.toHaveBeenCalled();
    h.window.webContents.emit('did-finish-load');
    h.window.close();
    await vi.waitFor(() => expect(h.allowed).toHaveBeenCalledTimes(1));
  });

  it('offers recovery for a genuinely unresponsive renderer without timing out a healthy stop', async () => {
    const h = harness();
    let finish: (reply: unknown) => void = () => undefined;
    h.options.request.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    h.options.request.mockImplementationOnce(() => new Promise(() => undefined));
    h.window.close();
    expect(h.options.decideUnavailable).not.toHaveBeenCalled();
    h.window.emit('unresponsive');
    expect(h.options.decideUnavailable).toHaveBeenCalledTimes(1);
    // Keep open must not wait for the hung renderer to acknowledge cancel.
    finish({ status: 'ready', dirty: false });
    await Promise.resolve();
    expect(h.allowed).not.toHaveBeenCalled();
    h.options.decideUnavailable.mockReturnValueOnce('leave');
    h.window.close();
    expect(h.options.decideUnavailable).toHaveBeenCalledTimes(2);
    expect(h.options.forceClose).toHaveBeenCalledTimes(1);
  });

  it('only bypasses unload for an explicit unavailable-renderer Close decision', async () => {
    const h = harness();
    h.options.request.mockResolvedValueOnce({ status: 'unavailable' });
    h.options.decideUnavailable.mockReturnValueOnce('leave');
    h.requestQuit();
    h.window.close();
    await vi.waitFor(() => expect(h.options.forceClose).toHaveBeenCalledTimes(1));
    expect(h.options.quit).toHaveBeenCalledTimes(1);
    expect(h.allowed).not.toHaveBeenCalled();
  });
});
