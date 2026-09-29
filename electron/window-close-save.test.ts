import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { WindowCloseGuard } from './window-close-guard.js';
import type { UnsavedCloseDecision } from './window-unload-decision.js';

function harness(decision: UnsavedCloseDecision, replies: Record<string, unknown[]>) {
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
  const options = {
    request: vi.fn(async (operation: string): Promise<unknown> => {
      return replies[operation]?.shift() ?? { status: 'cancelled' };
    }),
    decideUnsaved: vi.fn((): 'leave' | 'stay' => 'leave'),
    decideUnsavedClose: vi.fn((): UnsavedCloseDecision => decision),
    decideUnavailable: vi.fn((): 'leave' | 'stay' => 'stay'),
    forceClose: vi.fn(() => events.emit('closed')),
    isQuitRequested: () => false,
    cancelQuit: vi.fn(),
    quit: vi.fn(),
    reportFailure: vi.fn(),
  };
  const guard = new WindowCloseGuard(window, options);
  return { window, options, allowed, guard };
}

function operations(h: ReturnType<typeof harness>): string[] {
  return h.options.request.mock.calls.map(([operation]) => operation);
}

const dirty = { status: 'ready', dirty: true };
const clean = { status: 'ready', dirty: false };

describe("Save, Don't Save or Cancel when closing with unsaved changes (ADR-549)", () => {
  it('saves, then prepares the close again and closes', async () => {
    const h = harness('save', {
      prepare: [dirty, clean],
      save: [{ status: 'saved' }],
      approve: [{ status: 'retry' }, { status: 'approved' }],
    });
    h.window.close();
    await vi.waitFor(() => expect(h.allowed).toHaveBeenCalledTimes(1));

    expect(operations(h)).toEqual(['prepare', 'save', 'approve', 'prepare', 'approve']);
    // The saved project is clean, so the second pass asks nothing.
    expect(h.options.decideUnsavedClose).toHaveBeenCalledOnce();
    expect(h.options.decideUnsaved).not.toHaveBeenCalled();
  });

  it.each([{ status: 'cancelled' }, { status: 'unavailable' }, undefined])(
    'stays open when the save does not finish (%o)',
    async (reply) => {
      const h = harness('save', { prepare: [dirty], save: [reply] });
      h.window.close();
      await vi.waitFor(() => expect(h.options.cancelQuit).toHaveBeenCalledOnce());

      expect(operations(h)).toEqual(['prepare', 'save', 'cancel']);
      expect(h.allowed).not.toHaveBeenCalled();
      expect(h.guard.isClosing()).toBe(false);
    },
  );

  it("closes without saving on Don't Save", async () => {
    const h = harness('leave', { prepare: [dirty], approve: [{ status: 'approved' }] });
    h.window.close();
    await vi.waitFor(() => expect(h.allowed).toHaveBeenCalledTimes(1));
    expect(operations(h)).toEqual(['prepare', 'approve']);
  });

  it('stays open on Cancel', async () => {
    const h = harness('stay', { prepare: [dirty] });
    h.window.close();
    await vi.waitFor(() => expect(h.options.cancelQuit).toHaveBeenCalledOnce());
    expect(operations(h)).toEqual(['prepare', 'cancel']);
    expect(h.allowed).not.toHaveBeenCalled();
  });

  it('ignores a save that finishes after the window closed', async () => {
    let finish: (reply: unknown) => void = () => undefined;
    const h = harness('save', { prepare: [dirty] });
    h.options.request.mockImplementation(async (operation: string) =>
      operation === 'save' ? new Promise((resolve) => (finish = resolve)) : dirty,
    );
    h.window.close();
    await vi.waitFor(() => expect(operations(h)).toContain('save'));
    h.window.emit('closed');
    finish({ status: 'saved' });
    await Promise.resolve();
    expect(operations(h)).toEqual(['prepare', 'save']);
  });

  it('keeps Leave or Stay for a page navigation', () => {
    const h = harness('save', {});
    const unload = { preventDefault: vi.fn() };
    h.window.webContents.emit('will-prevent-unload', unload);
    expect(h.options.decideUnsaved).toHaveBeenCalledOnce();
    expect(h.options.decideUnsavedClose).not.toHaveBeenCalled();
    expect(unload.preventDefault).toHaveBeenCalledOnce();
  });
});
