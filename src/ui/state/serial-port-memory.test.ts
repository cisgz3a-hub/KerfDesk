import { describe, expect, it } from 'vitest';
import type { SerialPortIdentity, SerialPortRef } from '../../platform/types';
import {
  AUTO_CONNECT_STORAGE_KEY,
  chooseGrantedPort,
  forgetRememberedSerialPort,
  loadAutoConnectPreference,
  loadRememberedSerialPort,
  rememberSerialPort,
  saveAutoConnectPreference,
  SERIAL_PORT_MEMORY_STORAGE_KEY,
  usbIdLabel,
} from './serial-port-memory';

const CH340: SerialPortIdentity = { usbVendorId: 0x1a86, usbProductId: 0x7523 };
const CP2102: SerialPortIdentity = { usbVendorId: 0x10c4, usbProductId: 0xea60 };

function port(info?: SerialPortIdentity): SerialPortRef {
  return {
    ...(info === undefined ? {} : { info }),
    open: async () => {
      throw new Error('not opened in this test');
    },
  };
}

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

describe('chooseGrantedPort', () => {
  it('asks when nothing was picked before', () => {
    expect(chooseGrantedPort([], CH340)).toEqual({ kind: 'ask', reason: 'none' });
    expect(chooseGrantedPort([], null)).toEqual({ kind: 'ask', reason: 'none' });
  });

  it('uses the one granted port of the remembered adapter', () => {
    const laser = port(CH340);
    const choice = chooseGrantedPort([port(CP2102), laser], CH340);
    expect(choice).toEqual({ kind: 'use', port: laser });
  });

  it('asks rather than guess between two identical adapters', () => {
    expect(chooseGrantedPort([port(CH340), port(CH340)], CH340)).toEqual({
      kind: 'ask',
      reason: 'several',
    });
  });

  it('asks rather than switch to a different machine', () => {
    expect(chooseGrantedPort([port(CP2102)], CH340)).toEqual({ kind: 'ask', reason: 'different' });
  });

  it('uses a lone granted port when no adapter is remembered', () => {
    const only = port(CP2102);
    expect(chooseGrantedPort([only], null)).toEqual({ kind: 'use', port: only });
    expect(chooseGrantedPort([only], {})).toEqual({ kind: 'use', port: only });
    expect(chooseGrantedPort([only, port(CH340)], null)).toEqual({
      kind: 'ask',
      reason: 'several',
    });
  });
});

describe('remembered port storage', () => {
  it('round-trips the adapter identity and forgets it', () => {
    const storage = memoryStorage();
    expect(loadRememberedSerialPort(storage)).toBeNull();
    rememberSerialPort(storage, CH340);
    expect(loadRememberedSerialPort(storage)).toEqual(CH340);
    forgetRememberedSerialPort(storage);
    expect(loadRememberedSerialPort(storage)).toBeNull();
  });

  it('reads a damaged record as no memory', () => {
    const storage = memoryStorage();
    storage.setItem(SERIAL_PORT_MEMORY_STORAGE_KEY, '{not json');
    expect(loadRememberedSerialPort(storage)).toBeNull();
    storage.setItem(SERIAL_PORT_MEMORY_STORAGE_KEY, JSON.stringify({ usbVendorId: 70000 }));
    expect(loadRememberedSerialPort(storage)).toEqual({});
  });

  it('fails soft when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadRememberedSerialPort(broken)).toBeNull();
    expect(() => rememberSerialPort(broken, CH340)).not.toThrow();
    expect(() => forgetRememberedSerialPort(broken)).not.toThrow();
    expect(loadAutoConnectPreference(broken)).toBe(true);
    expect(() => saveAutoConnectPreference(broken, false)).not.toThrow();
  });

  it('keeps auto-connect on until the operator turns it off', () => {
    const storage = memoryStorage();
    expect(loadAutoConnectPreference(storage)).toBe(true);
    saveAutoConnectPreference(storage, false);
    expect(storage.getItem(AUTO_CONNECT_STORAGE_KEY)).toBe('off');
    expect(loadAutoConnectPreference(storage)).toBe(false);
    saveAutoConnectPreference(storage, true);
    expect(loadAutoConnectPreference(storage)).toBe(true);
    expect(loadAutoConnectPreference(null)).toBe(true);
  });

  it('labels USB IDs as four hex digits', () => {
    expect(usbIdLabel(CH340)).toBe('1a86:7523');
    expect(usbIdLabel({ usbVendorId: 0x303a })).toBeNull();
    expect(usbIdLabel(null)).toBeNull();
  });
});
