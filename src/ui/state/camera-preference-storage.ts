// Preferred-camera persistence (ADR-107 UX). The chosen deviceId is a
// BROWSER-local identifier (it changes across machines and permission
// resets), so it lives in localStorage — never in the .lf2 project — same as
// the calibration draft pattern. Failures (private mode, quota) degrade to
// "no preference" silently.

import { cameraSourceIdWithoutCredentials } from '../../core/camera/camera-capture-binding';
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
// storage rationale as the preferred deviceId.
const RTSP_CAMERA_URL_KEY = 'laserforge.camera.rtspUrl.v1';

export function loadRtspCameraUrl(): string | null {
  try {
    const stored = localStorage.getItem(RTSP_CAMERA_URL_KEY);
    if (stored === null) return null;
    const safe = rtspUrlWithoutCredentials(stored);
    if (safe !== stored) localStorage.setItem(RTSP_CAMERA_URL_KEY, safe);
    return safe;
  } catch {
    return null;
  }
}

export function saveRtspCameraUrl(url: string): void {
  try {
    localStorage.setItem(RTSP_CAMERA_URL_KEY, rtspUrlWithoutCredentials(url));
  } catch {
    // Storage unavailable: the URL simply won't survive reload.
  }
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
    if (safe !== address) {
      localStorage.setItem(PHONE_CAMERA_KEY, JSON.stringify({ app, address: safe }));
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
