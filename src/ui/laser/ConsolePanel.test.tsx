import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from '../state/laser-store';
import { ConsolePanel } from './ConsolePanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderPanel(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<ConsolePanel />);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    autofocusBusy: false,
    motionOperation: null,
    streamer: null,
    transcript: [],
    lastWriteError: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  vi.restoreAllMocks();
});

describe('ConsolePanel', () => {
  it('hides status polls and job stream lines by default', async () => {
    useLaserStore.setState({
      transcript: [
        {
          id: 1,
          at: 1,
          direction: 'in',
          raw: '<Idle|MPos:0.000,0.000,0.000|FS:0,0>',
          kind: 'status',
          source: 'controller',
        },
        { id: 2, at: 2, direction: 'out', raw: 'G1 X1\n', kind: 'gcode', source: 'job' },
        { id: 3, at: 3, direction: 'in', raw: 'error:8', kind: 'error', source: 'controller' },
      ],
    } as Partial<ReturnType<typeof useLaserStore.getState>>);

    const { host, unmount } = await renderPanel();

    expect(host.textContent).toContain('error:8');
    expect(host.textContent).not.toContain('<Idle|');
    expect(host.textContent).not.toContain('G1 X1');

    await unmount();
  });

  it('sends quick commands through the laser store action', async () => {
    const sendConsoleCommand = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      sendConsoleCommand,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderPanel();
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === '$I');
    if (button === undefined) throw new Error('$I button missing');

    await act(async () => {
      button.click();
    });

    expect(sendConsoleCommand).toHaveBeenCalledWith('$I');

    await unmount();
  });

  it('requires confirmation before sending a setting write', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const sendConsoleCommand = vi.fn(async () => undefined);
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
      sendConsoleCommand,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderPanel();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Console command"]');
    const send = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Send');
    if (input === null || send === undefined) throw new Error('console form missing');

    await act(async () => {
      setInputValue(input, '$32=1');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      send.click();
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(sendConsoleCommand).toHaveBeenCalledWith('$32=1', { confirmed: true });

    await unmount();
  });

  it('blocks normal quick commands during an active job but keeps realtime status available', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      streamer: {
        status: 'streaming',
        streamingMode: 'char-counted',
        queued: [],
        inFlight: [{ line: 'G1 X10 Y10 S500\n', bytes: 16 }],
        inFlightBytes: 16,
        completed: 0,
        total: 1,
        rxBufferBytes: 120,
      },
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderPanel();
    const info = [...host.querySelectorAll('button')].find((b) => b.textContent === '$I');
    const status = [...host.querySelectorAll('button')].find((b) => b.textContent === '?');
    if (info === undefined || status === undefined) throw new Error('quick buttons missing');

    expect(info.disabled).toBe(true);
    expect(info.title).toContain('A job is active.');
    expect(status.disabled).toBe(false);

    await unmount();
  });
});

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
}
