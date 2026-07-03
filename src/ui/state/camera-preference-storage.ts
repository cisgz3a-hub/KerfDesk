// Preferred-camera persistence (ADR-106 UX). The chosen deviceId is a
// BROWSER-local identifier (it changes across machines and permission
// resets), so it lives in localStorage — never in the .lf2 project — same as
// the calibration draft pattern. Failures (private mode, quota) degrade to
// "no preference" silently.

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
