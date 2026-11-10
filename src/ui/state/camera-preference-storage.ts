// Preferred-camera persistence (ADR-107 UX). The chosen deviceId is a
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

// The remembered RTSP and phone camera addresses live in
// remembered-camera-addresses.ts (ADR-692 Amendment 1).

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
