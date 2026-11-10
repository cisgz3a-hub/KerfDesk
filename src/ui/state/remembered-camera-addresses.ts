// The remembered network camera addresses: the last RTSP camera (ADR-116) and
// the phone camera (ADR-448). Machine-local operator input, like the preferred
// USB camera. Plain local storage keeps only their public form, scheme, host
// and port (ADR-692 Amendment 1); what a reconnect needs beyond it goes only to
// the desktop's secure storage, and is otherwise known for this run alone.
// The RTSP address is kept there in full; the phone address still without its
// login (ADR-448).

import {
  cameraAddressHasPrivateParts,
  cameraAddressWithoutUserinfo,
  publicCameraAddress,
} from '../../core/camera/camera-address-login';
import type { CameraAddressSlot, CameraAddressVault } from '../../core/camera/camera-address-vault';
import {
  phoneCameraAddressWithoutLogin,
  phoneCameraPublicAddress,
  type PhoneCameraApp,
} from '../camera/phone-camera-address';

const RTSP_CAMERA_URL_KEY = 'laserforge.camera.rtspUrl.v1';
const PHONE_CAMERA_KEY = 'laserforge.camera.phone.v1';

let vault: CameraAddressVault | undefined;
// What was typed this run, which wins over anything kept.
const typedThisRun = new Map<CameraAddressSlot, string>();
// What an older version left in plain storage, moved to the vault when read.
const olderPlain = new Map<CameraAddressSlot, string>();

/** Where the remembered addresses are kept in full; absent outside the desktop app. */
export function installCameraAddressVault(next: CameraAddressVault | undefined): void {
  vault = next;
  for (const slot of olderPlain.keys()) void kept(slot);
}

function remember(slot: CameraAddressSlot, address: string | null): void {
  olderPlain.delete(slot);
  if (address === null) typedThisRun.delete(slot);
  else typedThisRun.set(slot, address);
  void vault?.write(slot, address).catch(() => false);
}

// An older plain copy never replaces a kept address for the same camera,
// which may hold the login the plain copy had to leave out.
async function kept(slot: CameraAddressSlot): Promise<string | null> {
  const typed = typedThisRun.get(slot);
  if (typed !== undefined) return typed;
  const inVault = (await vault?.read(slot).catch(() => null)) ?? null;
  const older = olderPlain.get(slot);
  if (older === undefined || vault === undefined) return inVault ?? older ?? null;
  olderPlain.delete(slot);
  if (inVault !== null && sameResource(inVault, older)) return inVault;
  await vault.write(slot, older).catch(() => false);
  return older;
}

function sameResource(a: string, b: string): boolean {
  return cameraAddressWithoutUserinfo(a) === cameraAddressWithoutUserinfo(b);
}

function readPlain(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePlain(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the choice simply won't survive reload.
  }
}

export function rtspUrlWithoutCredentials(raw: string): string {
  return publicCameraAddress(raw);
}

/** The remembered RTSP address in its public form, as the field shows it. */
export function loadRtspCameraUrl(): string | null {
  const stored = readPlain(RTSP_CAMERA_URL_KEY);
  if (stored === null) return null;
  const safe = rtspUrlWithoutCredentials(stored);
  if (safe !== stored) {
    olderPlain.set('rtsp', stored.trim());
    if (vault !== undefined) void kept('rtsp');
    writePlain(RTSP_CAMERA_URL_KEY, safe);
  }
  return safe;
}

export function saveRtspCameraUrl(url: string): void {
  const full = url.trim();
  remember('rtsp', cameraAddressHasPrivateParts(full) ? full : null);
  writePlain(RTSP_CAMERA_URL_KEY, rtspUrlWithoutCredentials(full));
}

/** The remembered address to connect to: in full when it is kept, else its public form. */
export async function rememberedRtspCameraUrl(): Promise<string | null> {
  const remembered = loadRtspCameraUrl();
  if (remembered === null) return null;
  const full = await kept('rtsp');
  return full !== null && rtspUrlWithoutCredentials(full) === remembered ? full : remembered;
}

export type StoredPhoneCamera = { readonly app: PhoneCameraApp; readonly address: string };

/** The phone camera's app and its public address, as the field shows it. */
export function loadPhoneCamera(): StoredPhoneCamera | null {
  let stored: unknown;
  try {
    stored = JSON.parse(readPlain(PHONE_CAMERA_KEY) ?? 'null');
  } catch {
    return null;
  }
  if (typeof stored !== 'object' || stored === null) return null;
  const { app, address } = stored as Record<string, unknown>;
  if ((app !== 'ip-webcam' && app !== 'other') || typeof address !== 'string') return null;
  const safe = phoneCameraPublicAddress(address);
  if (safe !== address) {
    // Older versions kept the address with its path, never with its login.
    olderPlain.set('phone', phoneCameraAddressWithoutLogin(address));
    if (vault !== undefined) void kept('phone');
    writePlain(PHONE_CAMERA_KEY, JSON.stringify({ app, address: safe }));
  }
  return { app, address: safe };
}

export function savePhoneCamera(camera: StoredPhoneCamera): void {
  const safe = phoneCameraPublicAddress(camera.address);
  const withoutLogin = phoneCameraAddressWithoutLogin(camera.address);
  remember('phone', withoutLogin === safe ? null : withoutLogin);
  writePlain(PHONE_CAMERA_KEY, JSON.stringify({ app: camera.app, address: safe }));
}

/** The phone camera to connect to: its kept address when there is one, else the public one. */
export async function rememberedPhoneCamera(): Promise<StoredPhoneCamera | null> {
  const stored = loadPhoneCamera();
  if (stored === null) return null;
  const full = await kept('phone');
  return full !== null && phoneCameraPublicAddress(full) === stored.address
    ? { app: stored.app, address: full }
    : stored;
}

/** Test seam: forget the vault and everything known this run. */
export function resetCameraAddressVaultForTests(): void {
  vault = undefined;
  typedThisRun.clear();
  olderPlain.clear();
}
