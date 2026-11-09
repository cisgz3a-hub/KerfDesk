// Preferred-camera persistence (ADR-107 UX). The chosen deviceId is a
// BROWSER-local identifier (it changes across machines and permission
// resets), so it lives in localStorage — never in the .lf2 project — same as
// the calibration draft pattern. Failures (private mode, quota) degrade to
// "no preference" silently.

import { cameraAddressHasLogin } from '../../core/camera/camera-address-login';
import { cameraSourceIdWithoutCredentials } from '../../core/camera/camera-capture-binding';
import type { CameraAddressVault } from '../../core/camera/camera-address-vault';
import {
  phoneCameraAddressWithoutLogin,
  type PhoneCameraApp,
} from '../camera/phone-camera-address';

const PREFERRED_CAMERA_KEY = 'laserforge.camera.preferredDeviceId.v1';

export function loadPreferredCameraId(): string | null {
  try {
    return localStorage.getItem(PREFERRED_CAMERA_KEY);
  } catch {
    return null;
  }
}

export function savePreferredCameraId(deviceId: string): void {
  try {
    localStorage.setItem(PREFERRED_CAMERA_KEY, deviceId);
  } catch {
    // Storage unavailable: the choice simply won't survive reload.
  }
}

// The last RTSP camera URL is machine-local operator input (ADR-116) — same
// storage rationale as the preferred deviceId. Only its public form is kept
// here; the full address, login included, goes only to the desktop's secure
// storage (ADR-692), and is otherwise known for this run alone.
const RTSP_CAMERA_URL_KEY = 'laserforge.camera.rtspUrl.v1';

let addressVault: CameraAddressVault | undefined;
let fullAddressThisRun: string | null = null;

/** Where the full remembered address is kept; absent outside the desktop app. */
export function installCameraAddressVault(vault: CameraAddressVault | undefined): void {
  addressVault = vault;
  // An older record read before the vault was there moves into it now.
  if (vault !== undefined && fullAddressThisRun !== null) void vault.write(fullAddressThisRun);
}

function rememberFullAddress(url: string): void {
  const full = url.trim();
  fullAddressThisRun = cameraAddressHasLogin(full) ? full : null;
  void addressVault?.write(fullAddressThisRun).catch(() => false);
}

export function loadRtspCameraUrl(): string | null {
  try {
    const stored = localStorage.getItem(RTSP_CAMERA_URL_KEY);
    if (stored === null) return null;
    const safe = rtspUrlWithoutCredentials(stored);
    if (safe !== stored) {
      // An older version kept more than the public form here.
      rememberFullAddress(stored);
      try {
        localStorage.setItem(RTSP_CAMERA_URL_KEY, safe);
      } catch {
        // Cleanup is best effort; the sanitized readable choice remains usable.
      }
    }
    return safe;
  } catch {
    return null;
  }
}

export function saveRtspCameraUrl(url: string): void {
  rememberFullAddress(url);
  try {
    localStorage.setItem(RTSP_CAMERA_URL_KEY, rtspUrlWithoutCredentials(url));
  } catch {
    // Storage unavailable: the URL simply won't survive reload.
  }
}

/** The remembered address to connect to: in full when it is kept, else its public form. */
export async function rememberedRtspCameraUrl(): Promise<string | null> {
  const remembered = loadRtspCameraUrl();
  if (remembered === null) return null;
  const full = fullAddressThisRun ?? (await addressVault?.read().catch(() => null)) ?? null;
  return full !== null && rtspUrlWithoutCredentials(full) === remembered ? full : remembered;
}

/** Test seam: forget the vault and this run's full address. */
export function resetCameraAddressVaultForTests(): void {
  addressVault = undefined;
  fullAddressThisRun = null;
}

export function rtspUrlWithoutCredentials(raw: string): string {
  return cameraSourceIdWithoutCredentials(raw);
}

// The phone camera's app and address (ADR-448): machine-local operator input
// like the RTSP URL, and stored without any login for the same reason.
const PHONE_CAMERA_KEY = 'laserforge.camera.phone.v1';

export type StoredPhoneCamera = { readonly app: PhoneCameraApp; readonly address: string };

export function loadPhoneCamera(): StoredPhoneCamera | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(PHONE_CAMERA_KEY) ?? 'null');
    if (typeof stored !== 'object' || stored === null) return null;
    const { app, address } = stored as Record<string, unknown>;
    if ((app !== 'ip-webcam' && app !== 'other') || typeof address !== 'string') return null;
    const safe = phoneCameraAddressWithoutLogin(address);
    try {
      if (safe !== address) {
        localStorage.setItem(PHONE_CAMERA_KEY, JSON.stringify({ app, address: safe }));
      }
    } catch {
      // Cleanup is best effort; never return the credentials from the legacy record.
    }
    return { app, address: safe };
  } catch {
    return null;
  }
}

export function savePhoneCamera(camera: StoredPhoneCamera): void {
  try {
    localStorage.setItem(
      PHONE_CAMERA_KEY,
      JSON.stringify({ app: camera.app, address: phoneCameraAddressWithoutLogin(camera.address) }),
    );
  } catch {
    // Storage unavailable: the address simply won't survive reload.
  }
}

// Compact vs large (monitoring) camera panel — a viewing preference, so
// machine-local like the rest (F-CAM9).
const PANEL_WIDE_KEY = 'laserforge.camera.panelWide.v1';

export function loadCameraPanelWide(): boolean {
  try {
    return localStorage.getItem(PANEL_WIDE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveCameraPanelWide(wide: boolean): void {
  try {
    localStorage.setItem(PANEL_WIDE_KEY, String(wide));
  } catch {
    // Storage unavailable: the size simply won't survive reload.
  }
}

// Which kind of camera ran last (ADR-663 Amendment 1), so it can start again
// without the operator finding it: the laser's own camera, the chosen USB
// camera, or the remembered RTSP or phone address. Only the kind is kept; the
// device and addresses are the preferences above.
export type LastCameraSource = 'machine' | 'usb' | 'rtsp' | 'phone';

const LAST_SOURCE_KEY = 'laserforge.camera.lastSource.v1';
const LAST_SOURCES: ReadonlyArray<LastCameraSource> = ['machine', 'usb', 'rtsp', 'phone'];

export function loadLastCameraSource(): LastCameraSource | null {
  try {
    const stored = localStorage.getItem(LAST_SOURCE_KEY);
    return LAST_SOURCES.find((kind) => kind === stored) ?? null;
  } catch {
    return null;
  }
}

export function saveLastCameraSource(kind: LastCameraSource): void {
  try {
    localStorage.setItem(LAST_SOURCE_KEY, kind);
  } catch {
    // Storage unavailable: the camera simply won't start by itself next time.
  }
}

// The camera helpers the operator can switch off (ADR-663 Amendment 1). Both
// default on: they only act on a camera the operator has used before.
export type CameraHelperSettings = {
  /** Start the last camera when the panel opens, and a calibrated one with KerfDesk or the laser. */
  readonly autoStart: boolean;
  /** Take a new held picture when a job finishes. */
  readonly refreshAfterJob: boolean;
};

export const DEFAULT_CAMERA_HELPERS: CameraHelperSettings = {
  autoStart: true,
  refreshAfterJob: true,
};

const HELPERS_KEY = 'laserforge.camera.helpers.v1';

export function loadCameraHelpers(): CameraHelperSettings {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(HELPERS_KEY) ?? 'null');
    if (typeof stored !== 'object' || stored === null) return DEFAULT_CAMERA_HELPERS;
    const { autoStart, refreshAfterJob } = stored as Record<string, unknown>;
    return {
      autoStart: typeof autoStart === 'boolean' ? autoStart : DEFAULT_CAMERA_HELPERS.autoStart,
      refreshAfterJob:
        typeof refreshAfterJob === 'boolean'
          ? refreshAfterJob
          : DEFAULT_CAMERA_HELPERS.refreshAfterJob,
    };
  } catch {
    return DEFAULT_CAMERA_HELPERS;
  }
}

export function saveCameraHelpers(settings: CameraHelperSettings): void {
  try {
    localStorage.setItem(HELPERS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: the choice holds for this session only.
  }
}
