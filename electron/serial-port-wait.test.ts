import { describe, expect, it } from 'vitest';
import type { ElectronSerialPortSummary } from './serial-port-choice.js';
import {
  NO_SERIAL_PORTS_MESSAGE,
  waitForSerialPorts,
  type NoPortsPrompt,
  type SerialPortEventSource,
} from './serial-port-wait.js';

// Controller audit electron-native-1: an empty port list used to cancel the
// request silently. It now waits with the operator and offers hot-plugged ports.

type Listener = Parameters<SerialPortEventSource['on']>[1];

function fakeSession() {
  const listeners = new Map<string, Set<Listener>>();
  const source: SerialPortEventSource = {
    on: (event, listener) => {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(event, set);
    },
    removeListener: (event, listener) => {
      listeners.get(event)?.delete(listener);
    },
  };
  const emit = (event: string, port: ElectronSerialPortSummary, owner: unknown): void => {
    for (const listener of listeners.get(event) ?? []) listener({}, port, owner);
  };
  const count = (): number => [...listeners.values()].reduce((total, set) => total + set.size, 0);
  return { source, emit, count };
}

const CH340: ElectronSerialPortSummary = { portId: 'token-1', portName: 'COM5' };
const OWNER = { id: 'renderer' };
const RETRY = 0;
const CANCEL = 1;

describe('waitForSerialPorts', () => {
  it('names the likely causes and returns nothing when the operator cancels', async () => {
    const session = fakeSession();
    const messages: string[] = [];
    const prompt: NoPortsPrompt = async (options) => {
      messages.push(`${options.message}: ${options.detail}`);
      return { response: CANCEL };
    };

    expect(await waitForSerialPorts(session.source, OWNER, prompt)).toEqual([]);
    expect(messages[0]).toContain(NO_SERIAL_PORTS_MESSAGE);
    expect(messages[0]).toContain('CH340 or CP210x');
    expect(session.count()).toBe(0);
  });

  it('offers a port plugged in before Retry', async () => {
    const session = fakeSession();
    let asked = 0;
    const prompt: NoPortsPrompt = async () => {
      asked += 1;
      if (asked === 2) session.emit('serial-port-added', CH340, OWNER);
      return { response: RETRY };
    };

    expect(await waitForSerialPorts(session.source, OWNER, prompt)).toEqual([CH340]);
    // The first Retry found nothing and asked again.
    expect(asked).toBe(2);
    expect(session.count()).toBe(0);
  });

  it('ignores ports for another window and ports unplugged again', async () => {
    const session = fakeSession();
    let asked = 0;
    const prompt: NoPortsPrompt = async () => {
      asked += 1;
      if (asked === 1) {
        session.emit('serial-port-added', CH340, { id: 'other-window' });
        session.emit('serial-port-added', CH340, OWNER);
        session.emit('serial-port-removed', CH340, OWNER);
        return { response: RETRY };
      }
      return { response: CANCEL };
    };

    expect(await waitForSerialPorts(session.source, OWNER, prompt)).toEqual([]);
  });
});
