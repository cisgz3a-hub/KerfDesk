// The remembered RTSP address (ADR-692): only its public form in local
// storage; the full address, login included, only in the desktop's secure
// storage, from where reconnecting uses it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAMERA_LOGIN_FORMS,
  STAND_IN_SECRET,
} from '../../core/camera/camera-login-forms.test-fixture';
import type { CameraAddressVault } from '../../platform/types';
import {
  installCameraAddressVault,
  loadRtspCameraUrl,
  rememberedRtspCameraUrl,
  resetCameraAddressVaultForTests,
  saveRtspCameraUrl,
} from './camera-preference-storage';

const KEY = 'laserforge.camera.rtspUrl.v1';
const RTSP_FORMS = CAMERA_LOGIN_FORMS.filter((form) => form.kind === 'machine-rtsp');

function memoryVault(available = true) {
  let kept: string | null = null;
  const vault: CameraAddressVault = {
    read: vi.fn(async () => kept),
    write: vi.fn(async (address: string | null) => {
      kept = available ? address : null;
      return available && address !== null;
    }),
  };
  return { vault, kept: () => kept };
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

describe.each(RTSP_FORMS)('an RTSP address with a login in the $label form', (form) => {
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

  it('without secure storage, keeps only the public form and reconnects with it', async () => {
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

describe('the remembered address in secure storage', () => {
  it('is forgotten when an address with no login is connected', async () => {
    const { vault, kept } = memoryVault();
    installCameraAddressVault(vault);
    const form = RTSP_FORMS[0];
    if (form === undefined) throw new Error('fixture missing');
    saveRtspCameraUrl(form.address);
    await vi.waitFor(() => expect(kept()).toBe(form.address));
    saveRtspCameraUrl('rtsp://192.168.1.30/stream1');
    await vi.waitFor(() => expect(kept()).toBeNull());
    expect(await rememberedRtspCameraUrl()).toBe('rtsp://192.168.1.30/stream1');
  });

  it('is not used for a different camera than the one remembered here', async () => {
    const form = RTSP_FORMS[0];
    if (form === undefined) throw new Error('fixture missing');
    const vault: CameraAddressVault = {
      read: async () => form.address,
      write: async () => true,
    };
    localStorage.setItem(KEY, 'rtsp://192.168.1.99/other');
    installCameraAddressVault(vault);
    expect(await rememberedRtspCameraUrl()).toBe('rtsp://192.168.1.99/other');
  });

  it('is never asked for when nothing is remembered', async () => {
    const { vault } = memoryVault();
    installCameraAddressVault(vault);
    expect(await rememberedRtspCameraUrl()).toBeNull();
    expect(vault.read).not.toHaveBeenCalled();
  });
});
