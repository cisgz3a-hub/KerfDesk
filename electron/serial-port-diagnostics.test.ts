import { describe, expect, it } from 'vitest';
import {
  serialPortDiscoveryDiagnostic,
  serialPortSelectionDiagnostic,
} from './serial-port-diagnostics';

const ports = [
  {
    portId: 'COM7',
    portName: 'USB Serial Device',
    displayName: 'Controller 123',
    vendorId: '1A86',
    productId: '7523',
  },
];

describe('serial port diagnostics privacy', () => {
  it('redacts identifiers from packaged discovery and selection logs', () => {
    const policy = { isPackaged: true, detailedOptIn: true };
    const discovery = serialPortDiscoveryDiagnostic(ports, policy);
    const selected = serialPortSelectionDiagnostic('COM7', policy);
    expect(JSON.stringify([discovery, selected])).not.toMatch(
      /COM7|USB Serial Device|Controller 123|1A86|7523/u,
    );
    expect(discovery[0]).toContain('1 port(s)');
    expect(selected).toBe('[serial] Serial port selected.');
  });

  it('allows detailed identifiers only for an explicit development opt-in', () => {
    const disabled = serialPortDiscoveryDiagnostic(ports, {
      isPackaged: false,
      detailedOptIn: false,
    });
    const enabled = serialPortDiscoveryDiagnostic(ports, {
      isPackaged: false,
      detailedOptIn: true,
    });
    expect(JSON.stringify(disabled)).not.toContain('COM7');
    expect(JSON.stringify(enabled)).toContain('COM7');
  });
});
