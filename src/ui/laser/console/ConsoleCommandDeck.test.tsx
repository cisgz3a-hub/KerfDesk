import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobAwareConfirm } from '../../state/job-aware-dialogs';
import { useLaserStore } from '../../state/laser-store';
import { ConsoleCommandDeck } from './ConsoleCommandDeck';
import { readUserMacros, writeUserMacros } from './user-macros/user-macro-storage';

vi.mock('../../state/job-aware-dialogs', () => ({ jobAwareConfirm: vi.fn() }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalSendConsoleCommand = useLaserStore.getState().sendConsoleCommand;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
  useLaserStore.setState({
    connection: { kind: 'connected' },
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      feed: null,
      spindle: null,
      wco: null,
    },
    activeControllerKind: 'grbl-v1.1',
    fireActive: false,
    streamer: null,
    motionOperation: null,
    controllerOperation: null,
    autofocusBusy: false,
    sendConsoleCommand: originalSendConsoleCommand,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    fireActive: false,
    streamer: null,
    motionOperation: null,
    controllerOperation: null,
    autofocusBusy: false,
    sendConsoleCommand: originalSendConsoleCommand,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('ConsoleCommandDeck', () => {
  it('clears and records only successful sends, with ArrowDown restoring the draft', async () => {
    const sendConsoleCommand = vi.fn(async () => undefined);
    useLaserStore.setState({ sendConsoleCommand });
    const { host, unmount } = await renderDeck();
    const input = requiredInput(host);

    await enterCommand(input, '$I');
    await clickButton(host, 'Send');
    expect(input.value).toBe('');
    expect(sendConsoleCommand).toHaveBeenCalledWith('$I');

    await enterCommand(input, 'G0 X');
    await pressKey(input, 'ArrowUp');
    expect(input.value).toBe('$I');
    await pressKey(input, 'ArrowDown');
    expect(input.value).toBe('G0 X');

    sendConsoleCommand.mockRejectedValueOnce(new Error('Controller is busy.'));
    await clickButton(host, 'Send');
    expect(input.value).toBe('G0 X');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Controller is busy');
    expect(button(host, 'Send').disabled).toBe(false);

    await unmount();
  });

  it('confirms persistent writes and passes confirmation only after approval', async () => {
    const sendConsoleCommand = vi.fn(async () => undefined);
    useLaserStore.setState({ sendConsoleCommand });
    const { host, unmount } = await renderDeck();
    const input = requiredInput(host);

    await enterCommand(input, '$120=250');
    await clickButton(host, 'Send');

    expect(jobAwareConfirm).toHaveBeenCalled();
    expect(sendConsoleCommand).toHaveBeenCalledWith('$120=250', { confirmed: true });
    await unmount();
  });

  it('preserves a new draft typed while the previous command is still sending', async () => {
    let finishSend: (() => void) | null = null;
    const sendConsoleCommand = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSend = resolve;
        }),
    );
    useLaserStore.setState({ sendConsoleCommand });
    const { host, unmount } = await renderDeck();
    const input = requiredInput(host);

    await enterCommand(input, '$I');
    await act(async () => button(host, 'Send').click());
    await enterCommand(input, 'G0 X10');
    await act(async () => {
      finishSend?.();
      await Promise.resolve();
    });

    expect(input.value).toBe('G0 X10');
    await unmount();
  });

  it('uses driver metadata to keep realtime status available while fire blocks setup commands', async () => {
    const sendConsoleCommand = vi.fn(async () => undefined);
    useLaserStore.setState({ fireActive: true, sendConsoleCommand });
    const { host, unmount } = await renderDeck();
    const settings = button(host, '$$');
    const status = button(host, '?');

    expect(settings.disabled).toBe(true);
    expect(settings.title).toContain('Release the momentary Fire');
    expect(status.disabled).toBe(false);
    await act(async () => status.click());
    expect(sendConsoleCommand).toHaveBeenCalledWith('?');

    await unmount();
  });

  it('runs a numeric macro through the shared sender and successful command history', async () => {
    expect(
      writeUserMacros([
        {
          name: 'Nudge X',
          template: 'G0 X{{toString}}',
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    ).toEqual({ kind: 'ok' });
    const sendConsoleCommand = vi.fn(async () => undefined);
    useLaserStore.setState({ sendConsoleCommand });
    const { host, unmount } = await renderDeck();
    const consoleInput = requiredInput(host);
    const variableInput = requiredInputByLabel(host, 'Macro variable toString');

    expect(variableInput.value).toBe('');
    await enterCommand(consoleInput, 'draft command');
    await enterCommand(variableInput, '2.5');
    await clickButton(host, 'Run user macro');

    expect(sendConsoleCommand).toHaveBeenCalledWith('G0 X2.5', {
      provenance: {
        kind: 'user-macro',
        macroName: 'Nudge X',
        macroTemplate: 'G0 X{{toString}}',
      },
    });
    expect(consoleInput.value).toBe('draft command');
    await pressKey(consoleInput, 'ArrowUp');
    expect(consoleInput.value).toBe('G0 X2.5');
    await pressKey(consoleInput, 'ArrowDown');
    expect(consoleInput.value).toBe('draft command');

    await enterCommand(variableInput, '1 M3');
    await clickButton(host, 'Run user macro');
    expect(sendConsoleCommand).toHaveBeenCalledTimes(1);
    expect(requiredMacroPanel(host).querySelector('[role="alert"]')?.textContent).toContain(
      'one finite decimal number',
    );
    await unmount();
  });

  it('creates, edits, and deletes the last-persisted macro collection', async () => {
    const { host, unmount } = await renderDeck();

    await clickButton(host, 'New macro');
    await enterCommand(requiredInputByLabel(host, 'Macro name'), 'Read state');
    await enterCommand(requiredInputByLabel(host, 'Macro command template'), '$G');
    await clickButton(host, 'Save macro');
    expect(readUserMacros()).toMatchObject([{ name: 'Read state', template: '$G' }]);

    await clickButton(host, 'Edit');
    await enterCommand(requiredInputByLabel(host, 'Macro command template'), '$I');
    await clickButton(host, 'Save macro');
    expect(readUserMacros()).toMatchObject([{ name: 'Read state', template: '$I' }]);

    await clickButton(host, 'Delete');
    expect(readUserMacros()).toEqual([]);
    await unmount();
  });

  it('reports a storage failure inline without fabricating a saved macro', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { host, unmount } = await renderDeck();

    await clickButton(host, 'New macro');
    await enterCommand(requiredInputByLabel(host, 'Macro name'), 'Read state');
    await enterCommand(requiredInputByLabel(host, 'Macro command template'), '$G');
    await clickButton(host, 'Save macro');

    expect(readUserMacros()).toEqual([]);
    expect(requiredMacroPanel(host).querySelector('[role="alert"]')?.textContent).toContain(
      'saved collection was not changed',
    );
    await unmount();
  });
});

async function renderDeck(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<ConsoleCommandDeck />);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

function requiredInput(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Console command"]');
  if (input === null) throw new Error('console input missing');
  return input;
}

function requiredInputByLabel(host: HTMLElement, label: string): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (input === null) throw new Error(`${label} input missing`);
  return input;
}

function requiredMacroPanel(host: HTMLElement): HTMLDetailsElement {
  const summary = [...host.querySelectorAll('summary')].find((candidate) =>
    candidate.textContent?.includes('User macros'),
  );
  const panel = summary?.closest('details');
  if (panel === undefined || panel === null) throw new Error('user macro panel missing');
  return panel;
}

async function enterCommand(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function pressKey(input: HTMLInputElement, key: string): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

async function clickButton(host: HTMLElement, label: string): Promise<void> {
  await act(async () => button(host, label).click());
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (found === undefined) throw new Error(`${label} button missing`);
  return found;
}
