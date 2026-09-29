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
      async (script: string, _userGesture?: boolean): Promise<unknown> =>
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

function operations(h: ReturnType<typeof harness>): Array<string | undefined> {
  return h.target.webContents.executeJavaScript.mock.calls.map(
    ([script]) => /"operation":"(\w+)"/.exec(script)?.[1],
  );
}

describe('closing with unsaved changes (ADR-549)', () => {
  it("asks Save, Don't Save or Cancel with Save as the default", async () => {
    prompt.mockClear();
    const h = harness(true);
    const replies: unknown[] = [
      { status: 'ready', dirty: true },
      { status: 'saved' },
      { status: 'retry' },
      { status: 'ready', dirty: false },
      { status: 'approved' },
    ];
    h.target.webContents.executeJavaScript.mockImplementation(async () => replies.shift());
    prompt.mockReturnValueOnce(0);
    h.target.close();
    await vi.waitFor(() => expect(h.allowed).toHaveBeenCalledTimes(1));

    expect(prompt).toHaveBeenCalledOnce();
    expect(prompt.mock.calls[0]).toContainEqual(
      expect.objectContaining({
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
      }),
    );
    expect(operations(h)).toEqual(['prepare', 'save', 'approve', 'prepare', 'approve']);
    // Only Save runs as the operator's gesture, so Chromium may open its file picker.
    expect(h.target.webContents.executeJavaScript.mock.calls.map(([, gesture]) => gesture)).toEqual(
      [false, true, false, false, false],
    );
  });

  it.each([
    [1, ['prepare', 'approve'], true],
    [2, ['prepare', 'cancel'], false],
  ])('answers %i without saving', async (response, expected, closes) => {
    const h = harness(true);
    h.target.webContents.executeJavaScript.mockImplementation(async (script: string) =>
      script.includes('"operation":"prepare"')
        ? { status: 'ready', dirty: true }
        : { status: script.includes('"operation":"approve"') ? 'approved' : 'cancelled' },
    );
    prompt.mockReturnValueOnce(response);
    h.target.close();
    await vi.waitFor(() => expect(operations(h)).toEqual(expected));
    await vi.waitFor(() => expect(h.allowed).toHaveBeenCalledTimes(closes ? 1 : 0));
  });
});
