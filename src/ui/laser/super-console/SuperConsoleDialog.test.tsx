import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useLaserStore, type LaserState } from '../../state/laser-store';
import type { SerialTranscriptEntry } from '../../state/laser-transcript';
import { SuperConsoleLauncher } from './SuperConsoleLauncher';

const originalReadMachineSettings = useLaserStore.getState().readMachineSettings;
const originalSendConsoleCommand = useLaserStore.getState().sendConsoleCommand;

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function transcriptEntry(
  id: number,
  overrides: Partial<SerialTranscriptEntry> = {},
): SerialTranscriptEntry {
  return {
    id,
    at: id,
    direction: 'in',
    raw: `ok-${id}`,
    kind: 'ok',
    source: 'controller',
    ...overrides,
  };
}

function makePlatform(): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => null,
    },
  };
}

async function renderLauncher(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={makePlatform()}>
        <SuperConsoleLauncher />
      </PlatformProvider>,
    );
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

async function openDialog(host: HTMLDivElement): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>('button');
  expect(button?.textContent).toBe('Super console');
  await act(async () => {
    button?.click();
  });
}

function visibleRows(): number {
  const log = document.body.querySelector('[aria-label="Super console transcript"]');
  return log === null ? -1 : log.querySelectorAll('tbody > tr').length;
}

beforeEach(() => {
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    transcript: [],
    readMachineSettings: originalReadMachineSettings,
    sendConsoleCommand: originalSendConsoleCommand,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

afterEach(() => {
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    transcript: [],
    readMachineSettings: originalReadMachineSettings,
    sendConsoleCommand: originalSendConsoleCommand,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('SuperConsoleLauncher / SuperConsoleDialog', () => {
  it('opens the dialog and shows the full transcript, beyond the docked 150-entry cap', async () => {
    const entries = Array.from({ length: 201 }, (_, i) => transcriptEntry(i + 1));
    useLaserStore.setState({ transcript: entries } as Partial<
      ReturnType<typeof useLaserStore.getState>
    >);
    const { host, unmount } = await renderLauncher();
    await openDialog(host);
    expect(document.body.querySelector('.lf-dialog-backdrop')).not.toBeNull();
    expect(visibleRows()).toBe(201);
    expect([...document.body.querySelectorAll('th')].map((cell) => cell.textContent)).toEqual(
      expect.arrayContaining(['Timestamp', 'Direction', 'Source', 'Kind', 'Raw', 'Meaning']),
    );
    await unmount();
  });

  it('hides a group when its filter chip is unchecked', async () => {
    useLaserStore.setState({
      transcript: [
        transcriptEntry(1, { kind: 'error', raw: 'error:9' }),
        transcriptEntry(2),
        transcriptEntry(3, { kind: 'welcome', raw: "Grbl 1.1h ['$' for help]" }),
      ],
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderLauncher();
    await openDialog(host);
    expect(visibleRows()).toBe(3);
    const errorChip = Array.from(document.body.querySelectorAll('label'))
      .find((label) => label.textContent === 'Errors')
      ?.querySelector('input');
    await act(async () => {
      errorChip?.click();
    });
    expect(visibleRows()).toBe(2);
    expect(document.body.textContent).not.toContain('error:9');
    await unmount();
  });

  it('narrows the list with the search box', async () => {
    useLaserStore.setState({
      transcript: [
        transcriptEntry(1, { kind: 'setting', raw: '$32=1' }),
        transcriptEntry(2, { kind: 'setting', raw: '$120=500' }),
        transcriptEntry(3),
      ],
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderLauncher();
    await openDialog(host);
    const search = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="Search console lines"]',
    );
    expect(search).not.toBeNull();
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setValue?.call(search, '$120');
      search?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(visibleRows()).toBe(1);
    expect(document.body.textContent).toContain('$120=500');
    await unmount();
  });

  it('closes via the Close button', async () => {
    const { host, unmount } = await renderLauncher();
    await openDialog(host);
    const close = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Close',
    );
    await act(async () => {
      close?.click();
    });
    expect(document.body.querySelector('.lf-dialog-backdrop')).toBeNull();
    await unmount();
  });

  it('offers timestamped TSV for manual copy when clipboard access is unavailable', async () => {
    useLaserStore.setState({
      transcript: [transcriptEntry(1, { at: 1, raw: '$I\tvalue', decoded: 'line one\nline two' })],
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const { host, unmount } = await renderLauncher();
    await openDialog(host);
    const copy = button(document.body, 'Copy visible');
    await act(async () => copy.click());
    const manual = document.body.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Super console transcript to copy manually"]',
    );
    expect(manual?.value).toContain(
      'Timestamp\tDirection\tSource\tKind\tRaw\tDecoded\n1970-01-01T00:00:00.001Z',
    );
    expect(manual?.value).toContain('$I\\tvalue');
    expect(manual?.value).toContain('line one\\nline two');
    await unmount();
    if (descriptor === undefined) delete (navigator as { clipboard?: unknown }).clipboard;
    else Object.defineProperty(navigator, 'clipboard', descriptor);
  });

  it('sends through the shared safe command deck and recalls successful history', async () => {
    const readMachineSettings = vi.fn(async () => undefined);
    const sendConsoleCommand = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: { state: 'Idle' } as LaserState['statusReport'],
      controllerSessionEpoch: 41,
      readMachineSettings,
      sendConsoleCommand,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderLauncher();
    await openDialog(host);
    const deck = document.body.querySelector<HTMLElement>(
      'section[aria-label="Super console commands"]',
    );
    if (deck === null) throw new Error('Super console command deck missing');
    const input = deck.querySelector<HTMLInputElement>('input[aria-label="Console command"]');
    if (input === null) throw new Error('Super console input missing');

    await enterCommand(input, '$I');
    await act(async () => button(deck, 'Send').click());
    await enterCommand(input, '$G');
    await act(async () => button(deck, 'Send').click());
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
      );
    });

    expect(sendConsoleCommand).toHaveBeenNthCalledWith(1, '$I');
    expect(sendConsoleCommand).toHaveBeenNthCalledWith(2, '$G');
    expect(input.value).toBe('$G');
    expect(readMachineSettings).toHaveBeenCalledTimes(1);
    await unmount();
  });
});

async function enterCommand(input: HTMLInputElement, value: string): Promise<void> {
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function button(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (found === undefined) throw new Error(`${label} button missing`);
  return found;
}
