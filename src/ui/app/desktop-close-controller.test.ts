import { describe, expect, it, vi } from 'vitest';
import { DesktopCloseController, type DesktopCloseSnapshot } from './desktop-close-controller';

function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function harness(active = true) {
  let state: DesktopCloseSnapshot = { active, epoch: 1, dirty: true, warning: null, document: {} };
  const pending = deferred();
  const stop = vi.fn(() => pending.promise);
  const controller = new DesktopCloseController(() => state, stop);
  return {
    controller,
    pending,
    stop,
    patch: (patch: Partial<DesktopCloseSnapshot>) => (state = { ...state, ...patch }),
  };
}

describe('desktop application close handoff', () => {
  it('retains a delayed stop, joins duplicate close requests and suppresses duplicate unload writes', async () => {
    const h = harness();
    const reply = vi.fn();
    const pending = h.controller.prepare(1);
    void pending.then(reply);
    expect(h.controller.prepare(1)).toBe(pending);
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    expect(h.controller.handleBeforeUnload(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    h.controller.bestEffortStop();
    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(reply).not.toHaveBeenCalled();
    expect(h.controller.getNotice()?.kind).toBe('pending');
    h.patch({ active: false });
    h.pending.resolve();
    expect(await pending).toEqual({ status: 'ready', dirty: true });
    expect(h.controller.approve(1)).toEqual({ status: 'approved' });
    const finalEvent = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    expect(h.controller.handleBeforeUnload(finalEvent)).toBe(true);
    expect(h.controller.handleBeforeUnload(finalEvent)).toBe(true);
    expect(finalEvent.defaultPrevented).toBe(false);
    expect(h.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps failure visible and allows retry without resolving close prematurely', async () => {
    const h = harness();
    const pending = h.controller.prepare(1);
    const reply = vi.fn();
    void pending.then(reply);
    h.pending.reject(new Error('write rejected'));
    await vi.waitFor(() => expect(h.controller.getNotice()?.kind).toBe('failed'));
    expect(h.controller.getNotice()?.message).toContain('write rejected');
    expect(reply).not.toHaveBeenCalled();
    h.stop.mockImplementationOnce(async () => {
      h.patch({ active: false });
    });
    h.controller.retryStop();
    expect(await pending).toEqual({ status: 'ready', dirty: true });
    expect(h.stop).toHaveBeenCalledTimes(2);
  });

  it('cancels a slow close without promising to undo Abort or closing on late completion', async () => {
    const h = harness();
    const pending = h.controller.prepare(1);
    h.controller.keepOpen();
    expect(await pending).toEqual({ status: 'cancelled' });
    h.patch({ active: false });
    h.pending.resolve();
    await Promise.resolve();
    expect(h.controller.ownsUnload).toBe(false);
    expect(h.controller.getNotice()).toBeNull();
    expect(h.controller.approve(1)).toEqual({ status: 'retry' });
  });

  it('reclosing after cancelling a slow close joins the same outstanding stop', async () => {
    const h = harness();
    void h.controller.prepare(1);
    h.controller.keepOpen();
    const pending = h.controller.prepare(2);
    expect(h.stop).toHaveBeenCalledTimes(1);
    h.patch({ active: false });
    h.pending.resolve();
    expect(await pending).toEqual({ status: 'ready', dirty: true });
    expect(h.controller.approve(2)).toEqual({ status: 'approved' });
  });

  it('does not equate a settled stop with an unconfirmed controller stop', async () => {
    const h = harness();
    const pending = h.controller.prepare(1);
    const reply = vi.fn();
    void pending.then(reply);
    h.patch({ active: false, warning: 'Buffered motion may still be active.' });
    h.pending.resolve();
    await vi.waitFor(() => expect(h.controller.getNotice()?.kind).toBe('unconfirmed'));
    expect(reply).not.toHaveBeenCalled();
    const displayedNotice = h.controller.getNotice();
    if (displayedNotice !== null) h.controller.acknowledgeWarning(displayedNotice);
    expect(await pending).toEqual({ status: 'ready', dirty: true });
  });

  it('refuses a fulfilled stop that leaves the application job active', async () => {
    const h = harness();
    const pending = h.controller.prepare(1);
    h.pending.resolve();
    await vi.waitFor(() => expect(h.controller.getNotice()?.kind).toBe('failed'));
    h.controller.keepOpen();
    expect(await pending).toEqual({ status: 'cancelled' });
  });

  it('returns idle dirty state without sending Abort, and cancellation leaves it intact', async () => {
    const h = harness(false);
    expect(await h.controller.prepare(1)).toEqual({ status: 'ready', dirty: true });
    h.controller.keepOpen();
    expect(h.stop).not.toHaveBeenCalled();
    expect(await h.controller.prepare(2)).toEqual({ status: 'ready', dirty: true });
  });

  it('ignores a stale renderer cancel after a newer close request has taken ownership', async () => {
    const h = harness(false);
    await h.controller.prepare(1);
    h.controller.cancel(1);
    await h.controller.prepare(2);
    h.controller.cancel(1);
    expect(h.controller.ownsUnload).toBe(true);
    expect(h.controller.approve(2)).toEqual({ status: 'approved' });
  });

  it('ignores stale approval while a newer close owns the pending stop and unload veto', async () => {
    const h = harness();
    const first = h.controller.prepare(1);
    h.controller.cancel(1);
    expect(await first).toEqual({ status: 'cancelled' });
    const second = h.controller.prepare(2);
    const reply = vi.fn();
    void second.then(reply);
    const notice = h.controller.getNotice();

    expect(h.controller.approve(1)).toEqual({ status: 'retry' });
    await Promise.resolve();
    expect(reply).not.toHaveBeenCalled();
    expect(h.controller.ownsUnload).toBe(true);
    expect(h.controller.getNotice()).toBe(notice);
    expect(h.stop).toHaveBeenCalledTimes(1);
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    expect(h.controller.handleBeforeUnload(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);

    h.patch({ active: false });
    h.pending.resolve();
    expect(await second).toEqual({ status: 'ready', dirty: true });
    expect(h.controller.approve(2)).toEqual({ status: 'approved' });
  });

  it('ignores stale approval without consuming a newer ready close or its approval', async () => {
    const h = harness(false);
    await h.controller.prepare(1);
    h.controller.cancel(1);
    const second = h.controller.prepare(2);
    expect(await second).toEqual({ status: 'ready', dirty: true });

    expect(h.controller.approve(1)).toEqual({ status: 'retry' });
    expect(h.controller.ownsUnload).toBe(true);
    expect(h.controller.prepare(2)).toBe(second);
    expect(h.controller.approve(2)).toEqual({ status: 'approved' });
    expect(h.controller.approve(1)).toEqual({ status: 'retry' });
    const allowed = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    expect(h.controller.handleBeforeUnload(allowed)).toBe(true);
    expect(allowed.defaultPrevented).toBe(false);
    const repeated = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    expect(h.controller.handleBeforeUnload(repeated)).toBe(true);
    expect(repeated.defaultPrevented).toBe(true);
    expect(h.stop).not.toHaveBeenCalled();
  });

  it('rejects preparation if a new run, new dirty state or new warning arrives before approval', async () => {
    for (const patch of [
      { active: true, epoch: 2 },
      { dirty: false },
      { warning: 'USB lost' },
      { document: {} },
    ]) {
      const h = harness(false);
      await h.controller.prepare(1);
      h.patch(patch);
      expect(h.controller.approve(1)).toEqual({ status: 'retry' });
      expect(h.controller.ownsUnload).toBe(false);
    }
  });

  it('revalidates the one-use approval at the actual unload boundary', async () => {
    const h = harness(false);
    await h.controller.prepare(1);
    h.controller.approve(1);
    h.patch({ active: true, epoch: 2 });
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    h.controller.handleBeforeUnload(event);
    expect(event.defaultPrevented).toBe(true);
    expect(h.stop).not.toHaveBeenCalled();
  });

  it('keeps a changed warning or run context unacknowledged until the new notice is shown', async () => {
    const h = harness(false);
    h.patch({ warning: 'Warning A' });
    const pending = h.controller.prepare(1);
    const shownA = h.controller.getNotice();
    h.patch({ warning: 'Warning B', epoch: 2 });
    if (shownA !== null) h.controller.acknowledgeWarning(shownA);
    expect(h.controller.getNotice()?.message).toBe('Warning B');
    // A queued click from the old rendered notice must not acknowledge B.
    if (shownA !== null) h.controller.acknowledgeWarning(shownA);
    expect(h.controller.getNotice()?.message).toBe('Warning B');
    const shownB = h.controller.getNotice();
    if (shownB !== null) h.controller.acknowledgeWarning(shownB);
    expect(await pending).toEqual({ status: 'ready', dirty: true });
  });

  it('does not allow already-dirty document changes after approval to bypass confirmation', async () => {
    const h = harness(false);
    await h.controller.prepare(1);
    h.controller.approve(1);
    h.patch({ document: {} });
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    h.controller.handleBeforeUnload(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
