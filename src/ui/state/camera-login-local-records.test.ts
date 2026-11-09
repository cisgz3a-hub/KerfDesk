// What older versions kept on this computer with a camera login in it is
// rewritten without the login the next time it is read (ADR-692): the
// remembered machine, the camera's reference view and saved artwork.

import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CAMERA_LOGIN_FORMS,
  STAND_IN_SECRET,
  type CameraLoginForm,
} from '../../core/camera/camera-login-forms.test-fixture';
import { savedCameraModel } from '../../core/camera/model/model-fixtures';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import { MACHINE_PROFILE_FORMAT, MACHINE_PROFILE_SCHEMA_VERSION } from '../../io/machine-profile';
import {
  hasViewReference,
  loadViewReference,
  resetViewReferenceKeyRenameForTests,
} from '../camera/helpers/view-reference';
import { serializePersonalArtworkLibrary } from '../library/personal-artwork-format';
import { capturePersonalArtwork, type PersonalArtwork } from '../library/personal-artwork-model';
import { personalArtworkRepository } from '../library/personal-artwork-storage';
import { artworkProject } from '../library/personal-artwork-test-fixtures';
import { LAST_MACHINE_STORAGE_KEY, loadLastMachineSelection } from './last-machine-persistence';

function olderDevice(form: CameraLoginForm): DeviceProfile {
  return {
    ...DEFAULT_DEVICE_PROFILE,
    cameraModel: savedCameraModel({
      version: 1,
      sourceKind: form.kind,
      sourceId: form.address,
      width: 1280,
      height: 720,
      resizeMode: 'unknown',
    }),
  };
}

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { text: () => string } {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    text: () => [...values.values()].join('\n'),
  };
}

beforeEach(() => {
  localStorage.clear();
  resetViewReferenceKeyRenameForTests();
});

describe.each(CAMERA_LOGIN_FORMS)('a camera login in the $label form', (form) => {
  it('leaves the remembered machine the first time it is read', () => {
    const storage = memoryStorage();
    storage.setItem(
      LAST_MACHINE_STORAGE_KEY,
      JSON.stringify({
        format: MACHINE_PROFILE_FORMAT,
        schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
        profile: olderDevice(form),
        source: { kind: 'custom', label: 'Shop laser' },
        reviewNotes: [],
        machineKind: 'laser',
      }),
    );
    const restored = loadLastMachineSelection(storage);
    expect(restored?.profile.cameraModel?.capture?.sourceId).toBe(form.publicForm);
    expect(restored?.machineKind).toBe('laser');
    expect(storage.text()).not.toContain(STAND_IN_SECRET);
    expect(loadLastMachineSelection(storage)?.profile).toEqual(restored?.profile);
  });

  it('leaves the reference view key, and the reference stays found', () => {
    const record = savedCameraModel({
      version: 1,
      sourceKind: form.kind,
      sourceId: form.publicForm,
      width: 1280,
      height: 720,
      resizeMode: 'unknown',
    });
    const older = `laserforge.camera.viewReference.v1:${form.address}@${record.calibratedAt}`;
    localStorage.setItem(older, JSON.stringify({ width: 1, height: 1, data: btoa('\u0007') }));
    expect(hasViewReference(record)).toBe(true);
    expect(loadViewReference(record)?.data).toEqual(new Uint8Array([7]));
    expect(Object.keys(localStorage).join('\n')).not.toContain(STAND_IN_SECRET);
  });

  it('leaves saved artwork, in this computer’s store and in an exported library', async () => {
    const factory = new IDBFactory();
    const name = `library-${form.label}`;
    const fresh = await capturePersonalArtwork(
      {
        project: artworkProject(),
        projectDocumentEpoch: 1,
        selectedObjectId: 'text',
        additionalSelectedIds: new Set(['image']),
      },
      'Logo',
      'Jigs',
    );
    // What an older version kept: the project text with the camera as typed.
    const project = JSON.parse(fresh.projectJson) as Record<string, unknown>;
    const older: PersonalArtwork = {
      ...fresh,
      projectJson: JSON.stringify({ ...project, device: olderDevice(form) }),
    };
    await writeRaw(factory, name, older);
    const listed = await personalArtworkRepository(factory, name).list();
    expect(serializePersonalArtworkLibrary(listed)).not.toContain(STAND_IN_SECRET);
    expect(JSON.stringify(await readRaw(factory, name))).not.toContain(STAND_IN_SECRET);
  });
});

function openDb(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('artwork', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('open failed'));
  });
}

async function writeRaw(factory: IDBFactory, name: string, entry: PersonalArtwork): Promise<void> {
  const db = await openDb(factory, name);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('artwork', 'readwrite');
    tx.objectStore('artwork').put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('write failed'));
  });
  db.close();
}

async function readRaw(factory: IDBFactory, name: string): Promise<unknown[]> {
  const db = await openDb(factory, name);
  const rows = await new Promise<unknown[]>((resolve, reject) => {
    const request = db.transaction('artwork', 'readonly').objectStore('artwork').getAll();
    request.onsuccess = () => resolve(request.result as unknown[]);
    request.onerror = () => reject(request.error ?? new Error('read failed'));
  });
  db.close();
  return rows;
}
