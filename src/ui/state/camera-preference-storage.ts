// Preferred-camera persistence (ADR-107 UX). The chosen deviceId is a
// BROWSER-local identifier (it changes across machines and permission
// resets), so it lives in localStorage — never in the .lf2 project — same as
// the calibration draft pattern. Failures (private mode, quota) degrade to
// "no preference" silently.

import { cameraSourceIdWithoutCredentials } from '../../core/camera/camera-capture-binding';

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
