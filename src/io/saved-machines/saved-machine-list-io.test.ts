import { describe, expect, it } from 'vitest';
import { everyFieldProfile } from '../../__fixtures__/saved-machines';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  EMPTY_SAVED_MACHINE_LIST,
  addSavedMachine,
  createSavedMachine,
  importSavedMachine,
  setDefaultSavedMachine,
  type SavedMachineList,
} from '../../core/saved-machines/saved-machine-list';
import {
  deserializeMachineProfileDocument,
  serializeMachineProfileDocument,
} from '../machine-profile';
import {
  deserializeSavedMachineList,
  savedMachineProfileDocument,
  serializeSavedMachineList,
} from './saved-machine-list-io';

const FINGERPRINT = {
  firmware: 'grbl-v1.1',
  firmwareVersion: '1.1h.20190830',
  buildInfo: 'Shop router',
  buildOptions: 'VNMZL,15,128',
  usbVendorId: 0x1a86,
  usbProductId: 0x7523,
  settings: { $100: '800.000', $101: '800.000', $130: '400.000' },
} as const;

function twoMachineList(): SavedMachineList {
  const router = createSavedMachine({
    id: 'router',
    profile: everyFieldProfile(),
    machineKind: 'cnc',
    name: 'Shop 4040',
    controllerFingerprint: FINGERPRINT,
    now: 100,
  });
  const laser = createSavedMachine({
    id: 'laser',
    profile: DEFAULT_DEVICE_PROFILE,
    machineKind: 'laser',
    name: 'Falcon',
    now: 200,
  });
  return setDefaultSavedMachine(
    addSavedMachine(addSavedMachine(EMPTY_SAVED_MACHINE_LIST, router), laser),
    'router',
  );
}

function read(text: string): SavedMachineList {
  const result = deserializeSavedMachineList(text);
  if (result.kind !== 'ok') throw new Error(`unreadable: ${result.reason}`);
  return result.list;
}

function storedEntries(list: SavedMachineList): Array<Record<string, unknown>> {
  return (
    JSON.parse(serializeSavedMachineList(list)) as { machines: Array<Record<string, unknown>> }
  ).machines;
}

describe('saved machine list storage', () => {
  it('restores every profile field, the recorded controller and the default exactly', () => {
    const list = twoMachineList();
    const restored = deserializeSavedMachineList(serializeSavedMachineList(list));

    expect(restored).toEqual({ kind: 'ok', list, droppedEntries: 0 });
    if (restored.kind === 'ok') {
      expect(restored.list.machines[0]?.profile.scanOffsetCalibrationStatus).toBe('verified');
    }
  });

  it('stores each machine as a complete machine-profile document', () => {
    const [entry] = storedEntries(twoMachineList());
    const document = deserializeMachineProfileDocument(JSON.stringify(entry?.['document']));

    expect(document.kind).toBe('ok');
    if (document.kind === 'ok') {
      expect(document.document.source.label).toBe('Shop 4040');
      expect(document.document.profile.bedWidth).toBe(380);
    }
  });

  it('leaves out unreadable entries and repeated ids, keeping the rest', () => {
    const entries = storedEntries(twoMachineList());
    const [router, laser] = entries;
    const text = JSON.stringify({
      format: 'laserforge-saved-machines',
      schemaVersion: 1,
      defaultMachineId: 'router',
      machines: [
        { ...router, document: { format: 'something else' } },
        laser,
        { ...laser, name: 'Second copy' },
        { ...laser, id: 'no-kind', machineKind: 'plasma' },
        'not an entry',
      ],
    });
    const result = deserializeSavedMachineList(text);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.list.machines.map((machine) => machine.name)).toEqual(['Falcon']);
    expect(result.list.defaultMachineId).toBeNull();
    expect(result.droppedEntries).toBe(4);
  });

  it('keeps a machine whose recorded controller is malformed, forgetting only the recording', () => {
    const [router] = storedEntries(twoMachineList());
    const text = JSON.stringify({
      format: 'laserforge-saved-machines',
      schemaVersion: 1,
      defaultMachineId: null,
      machines: [{ ...router, controllerFingerprint: { usbVendorId: 70000, usbProductId: 1 } }],
    });
    const [machine] = read(text).machines;

    expect(machine?.name).toBe('Shop 4040');
    expect(machine?.controllerFingerprint).toBeUndefined();
  });

  it('rejects text that is not a saved machine list', () => {
    expect(deserializeSavedMachineList('{').kind).toBe('invalid');
    expect(deserializeSavedMachineList('{"format":"laserforge-project"}').kind).toBe('invalid');
    expect(
      deserializeSavedMachineList('{"format":"laserforge-saved-machines","schemaVersion":2}'),
    ).toEqual({ kind: 'invalid', reason: 'unsupported saved machine list version' });
    expect(serializeSavedMachineList(EMPTY_SAVED_MACHINE_LIST)).toContain('"machines":[]');
  });
});

describe('saved machine export and import', () => {
  it('round-trips a machine through a file, marking unbound scan offsets for verification', () => {
    const [router] = twoMachineList().machines;
    if (router === undefined) throw new Error('missing fixture');
    const file = serializeMachineProfileDocument(savedMachineProfileDocument(router));
    const opened = deserializeMachineProfileDocument(file);
    if (opened.kind !== 'ok') throw new Error('export was unreadable');
    const { machine } = importSavedMachine(EMPTY_SAVED_MACHINE_LIST, opened.document.profile, {
      newId: 'fresh',
      now: 300,
      preferredKind: 'cnc',
    });

    expect(machine.id).toBe('router');
    expect(machine.name).toBe('Shop 4040');
    expect(machine.machineKind).toBe('cnc');
    expect(machine.profile).toEqual({
      ...router.profile,
      scanOffsetCalibrationStatus: 'pending',
    });
    expect(opened.document.reviewNotes.join(' ')).toContain('verification pending');
  });
});
