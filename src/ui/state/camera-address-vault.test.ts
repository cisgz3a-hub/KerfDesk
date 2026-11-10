// The remembered camera addresses (ADR-692 and Amendment 1): only their
// public form, scheme, host and port, in plain local storage; what a reconnect
// needs beyond it only in the desktop's secure storage.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAMERA_LOGIN_FORMS,
  STAND_IN_SECRET,
} from '../../core/camera/camera-login-forms.test-fixture';
import type { CameraAddressSlot, CameraAddressVault } from '../../core/camera/camera-address-vault';
import {
  installCameraAddressVault,
  loadPhoneCamera,
  loadRtspCameraUrl,
  rememberedPhoneCamera,
  rememberedRtspCameraUrl,
  resetCameraAddressVaultForTests,
  savePhoneCamera,
  saveRtspCameraUrl,
} from './remembered-camera-addresses';

const KEY = 'laserforge.camera.rtspUrl.v1';
const PHONE_KEY = 'laserforge.camera.phone.v1';
const RTSP_FORMS = CAMERA_LOGIN_FORMS.filter((form) => form.kind === 'machine-rtsp');

function memoryVault(available = true) {
  const kept = new Map<CameraAddressSlot, string>();
  const vault: CameraAddressVault = {
    read: vi.fn(async (slot: CameraAddressSlot) => kept.get(slot) ?? null),
    write: vi.fn(async (slot: CameraAddressSlot, address: string | null) => {
      if (address === null || !available) kept.delete(slot);
      else kept.set(slot, address);
      return available && address !== null;
    }),
  };
  return { vault, kept: (slot: CameraAddressSlot = 'rtsp') => kept.get(slot) ?? null };
}

function localStorageText(): string {
  return Object.keys(localStorage)
    .map((key) => `${key}=${localStorage.getItem(key) ?? ''}`)
    .join('\n');
}

beforeEach(() => {
  localStorage.clear();
  resetCameraAddressVaultForTests();
});
afterEach(() => resetCameraAddressVaultForTests());

describe.each(RTSP_FORMS)('an RTSP address with a secret in the $label form', (form) => {
  it('is remembered here only in its public form, and in full only in secure storage', async () => {
    const { vault, kept } = memoryVault();
    installCameraAddressVault(vault);
    saveRtspCameraUrl(form.address);
    expect(localStorage.getItem(KEY)).toBe(form.publicForm);
    expect(localStorageText()).not.toContain(STAND_IN_SECRET);
    await vi.waitFor(() => expect(kept()).toBe(form.address));
    expect(loadRtspCameraUrl()).toBe(form.publicForm);
    // A later run reconnects with the full address from secure storage.
    resetCameraAddressVaultForTests();
    installCameraAddressVault(vault);
    expect(await rememberedRtspCameraUrl()).toBe(form.address);
  });

  it('moves out of local storage when an older version left it there', async () => {
    localStorage.setItem(KEY, form.address);
    const { vault, kept } = memoryVault();
    // The panel can read the preference before the vault is installed.
    expect(loadRtspCameraUrl()).toBe(form.publicForm);
    expect(localStorage.getItem(KEY)).toBe(form.publicForm);
    installCameraAddressVault(vault);
    await vi.waitFor(() => expect(kept()).toBe(form.address));
    expect(await rememberedRtspCameraUrl()).toBe(form.address);
  });

  it('without secure storage, keeps only the public form', async () => {
    const { vault, kept } = memoryVault(false);
    installCameraAddressVault(vault);
    saveRtspCameraUrl(form.address);
    resetCameraAddressVaultForTests();
    installCameraAddressVault(vault);
    expect(kept()).toBeNull();
    expect(localStorageText()).not.toContain(STAND_IN_SECRET);
    expect(await rememberedRtspCameraUrl()).toBe(form.publicForm);
  });
});

describe('the remembered RTSP address in secure storage', () => {
  it('is forgotten when an address with nothing past its host is connected', async () => {
    const { vault, kept } = memoryVault();
    installCameraAddressVault(vault);
    const form = RTSP_FORMS[0];
    if (form === undefined) throw new Error('fixture missing');
    saveRtspCameraUrl(form.address);
    await vi.waitFor(() => expect(kept()).toBe(form.address));
    saveRtspCameraUrl('rtsp://192.168.1.30/');
    await vi.waitFor(() => expect(kept()).toBeNull());
    expect(await rememberedRtspCameraUrl()).toBe('rtsp://192.168.1.30/');
  });

  it('is never replaced by an older plain copy of the same camera without its login', async () => {
    const { vault, kept } = memoryVault();
    const withLogin = `rtsp://viewer:${STAND_IN_SECRET}@192.168.1.20/live`;
    await vault.write('rtsp', withLogin);
    // What ADR-692 itself left in plain storage: the address without its login.
    localStorage.setItem(KEY, 'rtsp://192.168.1.20/live');
    installCameraAddressVault(vault);
    expect(loadRtspCameraUrl()).toBe('rtsp://192.168.1.20/');
    expect(await rememberedRtspCameraUrl()).toBe(withLogin);
    expect(kept()).toBe(withLogin);
  });

  it('is not used for another camera than the one remembered here', async () => {
    const form = RTSP_FORMS[0];
    if (form === undefined) throw new Error('fixture missing');
    const { vault } = memoryVault();
    await vault.write('rtsp', form.address);
    localStorage.setItem(KEY, 'rtsp://192.168.1.99/');
    installCameraAddressVault(vault);
    expect(await rememberedRtspCameraUrl()).toBe('rtsp://192.168.1.99/');
  });

  it('is never asked for when nothing is remembered', async () => {
    const { vault } = memoryVault();
    installCameraAddressVault(vault);
    expect(await rememberedRtspCameraUrl()).toBeNull();
    expect(vault.read).not.toHaveBeenCalled();
  });
});

describe('the remembered phone camera (ADR-448, ADR-692 Amendment 1)', () => {
  const OTHER_APP = `http://viewer:${STAND_IN_SECRET}@192.168.1.50:8080/${STAND_IN_SECRET}/shot.jpg?pwd=${STAND_IN_SECRET}`;

  it('keeps only host and port in plain storage, its path in secure storage, never its login', async () => {
    const { vault, kept } = memoryVault();
    installCameraAddressVault(vault);
    savePhoneCamera({ app: 'other', address: OTHER_APP });
    expect(JSON.parse(localStorage.getItem(PHONE_KEY) ?? 'null')).toEqual({
      app: 'other',
      address: 'http://192.168.1.50:8080/',
    });
    expect(localStorageText()).not.toContain(STAND_IN_SECRET);
    const path = `http://192.168.1.50:8080/${STAND_IN_SECRET}/shot.jpg`;
    await vi.waitFor(() => expect(kept('phone')).toBe(path));
    resetCameraAddressVaultForTests();
    installCameraAddressVault(vault);
    expect(await rememberedPhoneCamera()).toEqual({ app: 'other', address: path });
  });

  it('keeps an IP Webcam address as typed, which is already only host and port', () => {
    savePhoneCamera({ app: 'ip-webcam', address: '192.168.1.50:8080' });
    expect(loadPhoneCamera()).toEqual({ app: 'ip-webcam', address: '192.168.1.50:8080' });
  });

  it('moves an older plain path into secure storage when read', async () => {
    localStorage.setItem(
      PHONE_KEY,
      JSON.stringify({
        app: 'other',
        address: `http://192.168.1.50:8080/${STAND_IN_SECRET}/s.jpg`,
      }),
    );
    const { vault, kept } = memoryVault();
    expect(loadPhoneCamera()?.address).toBe('http://192.168.1.50:8080/');
    expect(localStorageText()).not.toContain(STAND_IN_SECRET);
    installCameraAddressVault(vault);
    await vi.waitFor(() =>
      expect(kept('phone')).toBe(`http://192.168.1.50:8080/${STAND_IN_SECRET}/s.jpg`),
    );
  });
});
