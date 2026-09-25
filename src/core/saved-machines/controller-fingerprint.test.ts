import { describe, expect, it } from 'vitest';
import { ROUTER_SETTINGS, LASER_SETTINGS } from '../../__fixtures__/saved-machines';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  controllerFingerprintFromEvidence,
  fingerprintCanIdentify,
  fingerprintMatchBasis,
  type ControllerFingerprint,
  type ControllerIdentityEvidence,
} from './controller-fingerprint';
import {
  EMPTY_SAVED_MACHINE_LIST,
  addSavedMachine,
  createSavedMachine,
  type SavedMachineList,
} from './saved-machine-list';
import { matchingSavedMachines, savedMachineSuggestion } from './saved-machine-recognition';

function rows(values: Readonly<Record<number, string>>): ControllerIdentityEvidence['settings'] {
  return Object.entries(values).map(([id, rawValue]) => ({ code: `$${id}`, rawValue }));
}

function fingerprintOf(
  values: Readonly<Record<number, string>>,
  extra: Partial<ControllerIdentityEvidence> = {},
): ControllerFingerprint {
  return controllerFingerprintFromEvidence({
    firmware: 'grbl-v1.1',
    buildInfo: null,
    usb: null,
    settings: rows(values),
    ...extra,
  });
}

const ROUTER = fingerprintOf(ROUTER_SETTINGS);
const LASER = fingerprintOf(LASER_SETTINGS);

function savedList(
  ...entries: ReadonlyArray<[string, ControllerFingerprint | undefined]>
): SavedMachineList {
  return entries.reduce<SavedMachineList>(
    (list, [id, controllerFingerprint]) =>
      addSavedMachine(
        list,
        createSavedMachine({
          id,
          profile: { ...DEFAULT_DEVICE_PROFILE, name: id },
          machineKind: 'laser',
          ...(controllerFingerprint === undefined ? {} : { controllerFingerprint }),
          now: 1,
        }),
      ),
    EMPTY_SAVED_MACHINE_LIST,
  );
}

describe('controller fingerprint', () => {
  it('keeps the banner, $I, USB ids and only the identity-bearing settings', () => {
    const fingerprint = controllerFingerprintFromEvidence({
      firmware: 'grbl-v1.1',
      buildInfo: {
        protocolVersion: '1.1h',
        buildRevision: '20190830',
        userInfo: ' Shop router ',
        optionCodes: ['V', 'N', 'M', 'Z', 'L'],
        plannerBufferBlocks: 15,
        rxBufferBytes: 128,
      },
      usb: { usbVendorId: 0x1a86, usbProductId: 0x7523 },
      settings: rows({ 0: '10', 100: '800.000', 110: '3000', 130: ' 400.000 ', 131: '' }),
    });

    expect(fingerprint).toEqual({
      firmware: 'grbl-v1.1',
      firmwareVersion: '1.1h.20190830',
      buildOptions: 'VNMZL,15,128',
      buildInfo: 'Shop router',
      usbVendorId: 0x1a86,
      usbProductId: 0x7523,
      settings: { $100: '800.000', $130: '400.000' },
    });
  });

  it('records nothing it was not told', () => {
    const fingerprint = controllerFingerprintFromEvidence({
      firmware: null,
      buildInfo: null,
      usb: { usbVendorId: 0x303a },
      settings: [],
    });

    expect(fingerprint).toEqual({});
    expect(fingerprintCanIdentify(fingerprint)).toBe(false);
  });

  it('can identify from three settings, a controller name or a distinctive USB id', () => {
    expect(fingerprintCanIdentify(ROUTER)).toBe(true);
    expect(fingerprintCanIdentify(fingerprintOf({ 100: '80', 101: '80' }))).toBe(false);
    expect(fingerprintCanIdentify({ buildInfo: 'Falcon' })).toBe(true);
    expect(fingerprintCanIdentify({ usbVendorId: 0x303a, usbProductId: 0x1001 })).toBe(true);
    expect(fingerprintCanIdentify({ usbVendorId: 0x1a86, usbProductId: 0x7523 })).toBe(false);
  });
});

describe('fingerprint match', () => {
  it('matches every recorded setting, comparing numbers by value', () => {
    const observed = fingerprintOf({ ...ROUTER_SETTINGS, 100: '800', 130: '400.0', 0: '10' });

    expect(fingerprintMatchBasis(ROUTER, observed)).toEqual(['12 controller settings']);
  });

  it('rejects a changed or missing recorded setting', () => {
    const { 131: _missing, ...withoutTravel } = ROUTER_SETTINGS;
    void _missing;

    expect(fingerprintMatchBasis(ROUTER, LASER)).toBeNull();
    expect(fingerprintMatchBasis(ROUTER, fingerprintOf(withoutTravel))).toBeNull();
    expect(fingerprintMatchBasis(ROUTER, { firmware: 'grbl-v1.1' })).toBeNull();
  });

  it('lets any contradicting controller report veto the match', () => {
    expect(fingerprintMatchBasis(ROUTER, { ...ROUTER, firmware: 'grblhal' })).toBeNull();
    expect(
      fingerprintMatchBasis(
        { ...ROUTER, firmwareVersion: '1.1h.20190830' },
        { ...ROUTER, firmwareVersion: '1.1f.20170801' },
      ),
    ).toBeNull();
    expect(
      fingerprintMatchBasis(
        { ...ROUTER, usbVendorId: 0x1a86, usbProductId: 0x7523 },
        { ...ROUTER, usbVendorId: 0x10c4, usbProductId: 0xea60 },
      ),
    ).toBeNull();
  });

  it('never treats a common USB serial bridge alone as this machine', () => {
    const bridge = { usbVendorId: 0x1a86, usbProductId: 0x7523 };
    const native = { usbVendorId: 0x303a, usbProductId: 0x1001 };

    expect(fingerprintMatchBasis(bridge, bridge)).toBeNull();
    expect(fingerprintMatchBasis(native, native)).toEqual(['USB 303A:1001']);
  });

  it('accepts the stored controller name and reports the agreeing firmware', () => {
    const recorded = { firmwareVersion: '1.1h.20190830', buildInfo: 'Shop router' };

    expect(fingerprintMatchBasis(recorded, recorded)).toEqual([
      'controller name “Shop router”',
      'firmware 1.1h.20190830',
    ]);
    expect(fingerprintMatchBasis({ firmwareVersion: '1.1h.20190830' }, recorded)).toBeNull();
  });

  it('ignores features the connection did not report instead of vetoing', () => {
    const recorded = { ...ROUTER, buildInfo: 'Shop router', usbVendorId: 0x303a };

    expect(fingerprintMatchBasis(recorded, ROUTER)).toEqual(['12 controller settings']);
  });
});

describe('saved machine suggestion', () => {
  it('suggests the one saved machine that matches', () => {
    const list = savedList(['router', ROUTER], ['laser', LASER], ['unrecorded', undefined]);
    const suggestion = savedMachineSuggestion(ROUTER, list, 'laser');

    expect(suggestion?.machine.id).toBe('router');
    expect(suggestion?.basis).toEqual(['12 controller settings']);
    expect(matchingSavedMachines(LASER, list.machines).map((match) => match.machine.id)).toEqual([
      'laser',
    ]);
  });

  it('suggests nothing for the machine already open', () => {
    const list = savedList(['router', ROUTER], ['laser', LASER]);

    expect(savedMachineSuggestion(ROUTER, list, 'router')).toBeNull();
  });

  it('suggests nothing when two saved machines look the same', () => {
    const list = savedList(['router', ROUTER], ['router copy', ROUTER]);

    expect(matchingSavedMachines(ROUTER, list.machines)).toHaveLength(2);
    expect(savedMachineSuggestion(ROUTER, list, undefined)).toBeNull();
  });

  it('suggests nothing when no saved machine matches', () => {
    const list = savedList(['router', ROUTER]);

    expect(savedMachineSuggestion(LASER, list, undefined)).toBeNull();
    expect(savedMachineSuggestion(LASER, EMPTY_SAVED_MACHINE_LIST, undefined)).toBeNull();
  });
});
