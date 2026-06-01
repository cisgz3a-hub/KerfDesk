import { describe, expect, it } from 'vitest';
import {
  serialPortDialogButtons,
  serialPortIdForDialogResponse,
  serialPortLabel,
  type ElectronSerialPortSummary,
} from './serial-port-choice.js';

const ports: ReadonlyArray<ElectronSerialPortSummary> = [
  {
    portId: 'COM3',
    portName: 'COM3',
    displayName: 'Falcon A1',
    vendorId: '1a86',
    productId: '7523',
  },
  {
    portId: 'COM7',
    portName: 'COM7',
  },
];

describe('serial-port-choice', () => {
  it('builds a human-readable label from the most useful port fields', () => {
    expect(serialPortLabel(ports[0])).toBe('Falcon A1 - COM3 - USB 1a86:7523');
    expect(serialPortLabel(ports[1])).toBe('COM7');
  });

  it('adds a cancel button after every available port', () => {
    expect(serialPortDialogButtons(ports)).toEqual([
      'Falcon A1 - COM3 - USB 1a86:7523',
      'COM7',
      'Cancel',
    ]);
  });

  it('maps a dialog button response to the selected port id', () => {
    expect(serialPortIdForDialogResponse(ports, 0)).toBe('COM3');
    expect(serialPortIdForDialogResponse(ports, 1)).toBe('COM7');
  });

  it('returns an empty id for cancel or out-of-range dialog responses', () => {
    expect(serialPortIdForDialogResponse(ports, 2)).toBe('');
    expect(serialPortIdForDialogResponse(ports, 99)).toBe('');
    expect(serialPortIdForDialogResponse([], 0)).toBe('');
  });
});
