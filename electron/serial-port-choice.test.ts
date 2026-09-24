import { describe, expect, it } from 'vitest';
import {
  serialPortDialogButtons,
  serialPortIdForDialogResponse,
  serialPortLabel,
  type ElectronSerialPortSummary,
} from './serial-port-choice.js';

// Electron's real shape: an opaque token for portId and decimal USB IDs
// (6790:29987 is a CH340's 1a86:7523).
const ports: ReadonlyArray<ElectronSerialPortSummary> = [
  {
    portId: '9C4B2E0F7A1D4E3B8F6A2C5D1E0B9A87',
    portName: 'COM5',
    displayName: 'USB-SERIAL CH340 (COM5)',
    vendorId: '6790',
    productId: '29987',
  },
  {
    portId: '0F1E2D3C4B5A69788796A5B4C3D2E1F0',
    portName: 'COM7',
  },
];

describe('serial-port-choice', () => {
  it('builds a human-readable label from the most useful port fields', () => {
    expect(serialPortLabel(ports[0])).toBe('USB-SERIAL CH340 (COM5) - COM5 - USB 1a86:7523');
    expect(serialPortLabel(ports[1])).toBe('COM7');
  });

  // Controller audit electron-native-4: the IDs read as Device Manager shows them.
  it('shows USB IDs as four hex digits and drops ids it cannot read', () => {
    expect(
      serialPortLabel({ portId: 't', portName: 'COM3', vendorId: '1027', productId: '24577' }),
    ).toBe('COM3 - USB 0403:6001');
    expect(
      serialPortLabel({ portId: 't', portName: 'COM3', vendorId: '', productId: '24577' }),
    ).toBe('COM3');
    expect(
      serialPortLabel({ portId: 't', portName: 'COM3', vendorId: '1a86', productId: '7523' }),
    ).toBe('COM3');
    expect(
      serialPortLabel({ portId: 't', portName: 'COM3', vendorId: '70000', productId: '1' }),
    ).toBe('COM3');
  });

  it('adds a cancel button after every available port', () => {
    expect(serialPortDialogButtons(ports)).toEqual([
      'USB-SERIAL CH340 (COM5) - COM5 - USB 1a86:7523',
      'COM7',
      'Cancel',
    ]);
  });

  it('maps a dialog button response to the selected port id', () => {
    expect(serialPortIdForDialogResponse(ports, 0)).toBe('9C4B2E0F7A1D4E3B8F6A2C5D1E0B9A87');
    expect(serialPortIdForDialogResponse(ports, 1)).toBe('0F1E2D3C4B5A69788796A5B4C3D2E1F0');
  });

  it('returns an empty id for cancel or out-of-range dialog responses', () => {
    expect(serialPortIdForDialogResponse(ports, 2)).toBe('');
    expect(serialPortIdForDialogResponse(ports, 99)).toBe('');
    expect(serialPortIdForDialogResponse([], 0)).toBe('');
  });
});
