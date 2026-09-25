import { describe, expect, it } from 'vitest';
import { everyFieldProfile } from '../../__fixtures__/saved-machines';
import { createSavedMachine } from '../../core/saved-machines/saved-machine-list';
import { recognitionSummary, savedMachineSummary } from './saved-machine-describe';

describe('saved machine descriptions', () => {
  it('summarises the work area, controller and mode', () => {
    const machine = createSavedMachine({
      id: 'router',
      profile: everyFieldProfile(),
      machineKind: 'cnc',
      now: 1,
    });

    expect(savedMachineSummary(machine)).toMatch(/^380 × 390 mm · .+ · CNC$/);
  });

  it('says how, if at all, the machine is recognised on connect', () => {
    expect(recognitionSummary(undefined)).toContain('Controller not recorded');
    expect(
      recognitionSummary({ usbVendorId: 0x1a86, usbProductId: 0x7523, settings: { $100: '80' } }),
    ).toBe(
      'Controller recorded, but it reported too few settings to tell it apart and its USB adapter (1A86:7523) is a common chip. KerfDesk will not suggest it on connect.',
    );
    expect(recognitionSummary({ firmware: 'grbl-v1.1' })).toBe(
      'Controller recorded, but it reported too little to be recognised on connect.',
    );
    expect(
      recognitionSummary({
        buildInfo: 'Shop router',
        firmwareVersion: '1.1h.20190830',
        usbVendorId: 0x303a,
        usbProductId: 0x1001,
        settings: { $100: '800', $101: '800', $130: '400' },
      }),
    ).toBe(
      'Recognised on connect by 3 controller settings, controller name “Shop router”, firmware 1.1h.20190830, USB 303A:1001.',
    );
  });
});
