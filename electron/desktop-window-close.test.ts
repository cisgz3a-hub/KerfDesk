import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { installDesktopWindowClose } from './desktop-window-close';

const { prompt } = vi.hoisted(() => ({ prompt: vi.fn(() => 0) }));
vi.mock('electron', () => ({ dialog: { showMessageBoxSync: prompt } }));

function harness(initiallyAdmitted = false, includeAdmission = true) {
  let admitted = initiallyAdmitted;
  let trusted = true;
  const allowed = vi.fn();
  const webContents = Object.assign(new EventEmitter(), {
    getURL: () => 'app://app/index.html',
    executeJavaScript: vi.fn(
      async (script: string): Promise<unknown> =>
        script.includes('"operation":"prepare"')
          ? { status: 'ready', dirty: false }
          : { status: 'approved' },
    ),
  });
  const target = Object.assign(new EventEmitter(), {
    webContents,
    destroy: vi.fn(),
    close: vi.fn(() => {
      const event = { preventDefault: vi.fn() };
      target.emit('close', event);
      if (event.preventDefault.mock.calls.length === 0) allowed();
    }),
  });
  const isWorkspaceAdmitted = vi.fn(() => admitted === true);
  const quit = vi.fn(() => target.close());
  let quitting = false;
  const guard = installDesktopWindowClose(target as unknown as BrowserWindow, {
    isTrustedRenderer: () => trusted,
    ...(includeAdmission ? { isWorkspaceAdmitted } : {}),
    isQuitRequested: () => quitting,
    cancelQuit: vi.fn(),
    quit,
  });
  return {
    target,
    allowed,
    guard,
    isWorkspaceAdmitted,
    quit,
    admit: () => {
      admitted = true;
    },
    untrust: () => {
      trusted = false;
    },
    quitting: () => {
      quitting = true;
    },
  };
}

describe('desktop close at commercial admission', () => {
  it('closes a trusted never-admitted activation screen without a renderer handoff', async () => {
    const h = harness();
    h.target.close();
    await vi.waitFor(() => expect(h.allowed).toHaveBeenCalledTimes(1));
    expect(h.target.webContents.executeJavaScript).not.toHaveBeenCalled();
  });
  it('still requires a trusted renderer before the admission exception applies', async () => {
    const h = harness();
    h.untrust();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.target.close();
    await vi.waitFor(() => expect(h.guard.isClosing()).toBe(false));
    expect(h.isWorkspaceAdmitted).not.toHaveBeenCalled();
    expect(h.allowed).not.toHaveBeenCalled();
    warning.mockRestore();
  });
  it.each([true, undefined])(
    'preserves workspace handoff when admission is %s',
    async (admitted) => {
      // Explicit undefined tests a caller that does not opt into licence admission.
      const h = harness(admitted, admitted !== undefined);
      h.target.close();
      await vi.waitFor(() => expect(h.allowed).toHaveBeenCalledTimes(1));
      expect(h.target.webContents.executeJavaScript).toHaveBeenCalledTimes(2);
    },
  );
  it('reprepares the workspace if admission settles after gate preparation', async () => {
    const h = harness();
    h.isWorkspaceAdmitted.mockImplementationOnce(() => {
      queueMicrotask(h.admit);
      return false;
    });
    h.target.close();
    await vi.waitFor(() => expect(h.allowed).toHaveBeenCalledTimes(1));
    expect(h.target.webContents.executeJavaScript).toHaveBeenCalledTimes(2);
    expect(h.target.webContents.executeJavaScript.mock.calls[0]?.[0]).toContain(
      '"operation":"prepare"',
    );
  });
  it('vetoes synthetic approval if admission settles during native quit, then waits for handoff', async () => {
    const h = harness();
    h.quitting();
    h.quit.mockImplementationOnce(() => {
      h.admit();
      h.target.close();
    });
    let finish: (value: unknown) => void = () => undefined;
    h.target.webContents.executeJavaScript.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    h.target.close();
    await vi.waitFor(() => expect(h.target.webContents.executeJavaScript).toHaveBeenCalledTimes(1));
    expect(h.allowed).not.toHaveBeenCalled();
    finish({ status: 'ready', dirty: false });
    await vi.waitFor(() => expect(h.allowed).toHaveBeenCalledTimes(1));
    expect(h.target.webContents.executeJavaScript).toHaveBeenCalledTimes(2);
  });
});
