// Annoyance audit A3-P2-4: Enter on a blocked Console command did nothing, and
// the reason was only a hover tooltip that talked about jogging and framing.
// The reason now shows under the field once a send is tried, in the Console's
// own words, and goes when the block does.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from '../../state/laser-store';
import { ConsoleCommandDeck } from './ConsoleCommandDeck';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalSendConsoleCommand = useLaserStore.getState().sendConsoleCommand;
const WAITING = 'Waiting for the controller to report its status';
const IDLE_REPORT = {
  state: 'Idle' as const,
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: null,
  spindle: null,
  wco: null,
};

let host: HTMLDivElement;
let root: Root | null = null;
let sendConsoleCommand: ReturnType<typeof vi.fn>;

function input(): HTMLInputElement {
  const found = host.querySelector<HTMLInputElement>('input[aria-label="Console command"]');
  if (found === null) throw new Error('console input missing');
  return found;
}

function sendButton(): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (found === null) throw new Error('Send button missing');
  return found;
}

function alertText(): string | null {
  return host.querySelector('[role="alert"]')?.textContent ?? null;
}

async function type(value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function pressEnter(): Promise<void> {
  await act(async () => {
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  });
}

beforeEach(async () => {
  localStorage.clear();
  sendConsoleCommand = vi.fn(async () => undefined);
  useLaserStore.setState({
    connection: { kind: 'connected' },
    // What the store leaves after any Console command that can change state.
    statusReport: null,
    activeControllerKind: 'grbl-v1.1',
    fireActive: false,
    streamer: null,
    motionOperation: null,
    controllerOperation: null,
    autofocusBusy: false,
    pendingUntrackedAcks: 0,
    sendConsoleCommand,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(<ConsoleCommandDeck />);
  });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host.remove();
  localStorage.clear();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    sendConsoleCommand: originalSendConsoleCommand,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('ConsoleCommandDeck with a blocked command', () => {
  it('says why under the field when Enter is pressed, and sends nothing', async () => {
    await type('G0 X1');
    expect(sendButton().disabled).toBe(true);
    expect(alertText()).toBeNull();

    await pressEnter();
    expect(alertText()).toContain(WAITING);
    expect(sendConsoleCommand).not.toHaveBeenCalled();
  });

  it('uses the Console wording, not the jog pad wording', async () => {
    await type('G0 X1');
    expect(sendButton().title).toContain(WAITING);
    expect(sendButton().title).not.toContain('jogging');
    expect(input().title).not.toContain('framing');
  });

  it('drops the reason when the block clears, and Enter then sends', async () => {
    await type('G0 X1');
    await pressEnter();
    expect(alertText()).toContain(WAITING);

    await act(async () => {
      useLaserStore.setState({ statusReport: IDLE_REPORT } as Partial<
        ReturnType<typeof useLaserStore.getState>
      >);
    });
    expect(alertText()).toBeNull();
    expect(sendButton().disabled).toBe(false);

    await pressEnter();
    // An unblocked Enter is the browser's own form submit, not this handler's.
    expect(alertText()).toBeNull();
    await act(async () => {
      host.querySelector('form')?.requestSubmit();
    });
    expect(sendConsoleCommand).toHaveBeenCalledWith('G0 X1');
  });

  it('drops the reason when the draft changes', async () => {
    await type('G0 X1');
    await pressEnter();
    expect(alertText()).toContain(WAITING);
    await type('G0 X12');
    expect(alertText()).toBeNull();
  });

  it('names the block for a command the form is asked to submit', async () => {
    useLaserStore.setState({ statusReport: { ...IDLE_REPORT, state: 'Run' } } as Partial<
      ReturnType<typeof useLaserStore.getState>
    >);
    await type('G0 X1');
    await act(async () => {
      host
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(alertText()).toContain('Machine must be Idle before sending this console command');
    expect(sendConsoleCommand).not.toHaveBeenCalled();
  });
});
