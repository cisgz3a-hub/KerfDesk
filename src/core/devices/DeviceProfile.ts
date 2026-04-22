/**
 * Device profiles — save/load machine configurations.
 * Users with multiple lasers can switch between them instantly.
 */

import { type Scene } from '../scene/Scene';
import { type ScanningOffsetTable } from '../plan/ScanningOffset';
import { type ResponseCurve } from '../materials/ResponseCurve';
import {
  BUILT_IN_FOOTER_TEMPLATES,
  BUILT_IN_HEADER_TEMPLATES,
  DEFAULT_FOOTER_TEMPLATE_NAME,
  DEFAULT_HEADER_TEMPLATE_NAME,
} from '../plan/GcodeTemplates';

/** Physical home corner after GRBL homing ($23). Drives Y-flip for G-code vs canvas (Y-down). */
export type MachineOriginCorner = 'front-left' | 'rear-left' | 'front-right' | 'rear-right';

/**
 * Connection metadata for a DeviceProfile. When absent, profiles are treated as
 * the historical `serial` flavour (GRBL over USB or WiFi bridge). Falcon A1 Pro
 * WiFi profiles use the `falcon-wifi` variant and talk to the device directly
 * via the Creality HTTP + WebSocket API (see electron/falcon-wifi/).
 */
export type DeviceConnection =
  | {
      kind: 'serial';
      /** Kept here for future parity; currently DeviceProfile.baudRate is the source of truth. */
      baudRate?: number;
      preferredPort?: string;
    }
  | {
      kind: 'falcon-wifi';
      /** IPv4 or hostname of the Falcon on the LAN. */
      ip: string;
      /** MAC address (lowercased, colon-separated) for DHCP-reservation hint. Optional. */
      macAddress?: string;
      /** Cached from last successful /system/getDeviceModel. */
      deviceModel?: string;
      /** Cached from last successful /system/getCurVersion. */
      firmwareVersion?: string;
      /** Cached from last successful /work/getLayerType. */
      laserInfo?: {
        laserType: string;
        laserClass: string;
        zaxisVersion: string;
        laserSN: string;
      };
      /** Device serial from /system/getSN (if supported by firmware). */
      serialNumber?: string;
    };

export type DeviceConnectionKind = DeviceConnection['kind'];

export function getProfileConnectionKind(p: DeviceProfile | null | undefined): DeviceConnectionKind {
  return p?.connection?.kind ?? 'serial';
}

export interface DeviceProfile {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;

  // Machine info
  machineType: 'diode' | 'co2' | 'fiber';
  watts: number;
  brand: string;
  model: string;

  // Workspace
  bedWidth: number;
  bedHeight: number;
  /** Where (0,0) sits after homing — default front-left (e.g. Wainlux $23=3). */
  originCorner: MachineOriginCorner;

  // GRBL settings
  maxFeedRate: number;     // mm/min
  maxSpindle: number;      // S-value (usually 255 or 1000)
  /** Optional per-axis max rate from GRBL ($110/$111). */
  maxRateX?: number;
  maxRateY?: number;
  /** Optional per-axis acceleration from GRBL ($120/$121). */
  maxAccelX?: number;
  maxAccelY?: number;
  homingEnabled: boolean;
  softLimitsEnabled: boolean;
  /**
   * Legacy: when `originCorner` is absent in storage, `invertY === false` maps to `rear-left`
   * (no Y flip). Prefer `originCorner` for new profiles.
   */
  invertY: boolean;
  /** Whether to rapid to work origin (0,0) after each job. Default true. */
  returnToOrigin: boolean;

  // Connection
  baudRate: number;
  preferredPort?: string;

  // Custom G-code
  startGcode: string;
  endGcode: string;
  /** Custom G-code header template. Uses {VAR} placeholders. See GcodeTemplates. */
  gcodeHeaderTemplate?: string;
  /** Custom G-code footer template. Uses {VAR} placeholders. See GcodeTemplates. */
  gcodeFooterTemplate?: string;

  /** Max acceleration mm/s² (GRBL-style). Used for raster power vs velocity. */
  maxAccelMmPerS2?: number;
  /** Default acceleration-aware raster power when layer does not override. */
  accelAwarePower?: boolean;
  /** Default minimum power ratio during raster decel. */
  minPowerRatioAccel?: number;

  /** Scanning offset calibration table for compensating laser firing latency. */
  scanningOffsets?: ScanningOffsetTable;

  /** When true, overscan is computed from scan speed and machine accel (see SmartOverscan). */
  smartOverscanEnabled?: boolean;
  /** Default manual overscan (mm) when smart overscan is off; also fallback if layer value missing. */
  overscanMm?: number;

  /**
   * Whether this machine exposes an autofocus trigger command.
   * If false or missing, Focus UI controls stay hidden.
   */
  autoFocusSupported?: boolean;
  /**
   * Raw autofocus command sent to the machine (no trailing newline).
   * Examples: "$HZ1", "G38.2 Z-10 F100"
   */
  autoFocusCommand?: string;
  /** Autofocus timeout in milliseconds. Default used by UI/service is 15000. */
  autoFocusTimeoutMs?: number;

  /**
   * Optional connection metadata. When omitted, the profile is treated as
   * serial/GRBL (the historical shape). Present for Falcon A1 Pro WiFi
   * profiles so the UI can pick the correct connection & status widgets.
   */
  connection?: DeviceConnection;

  /**
   * Material response curves keyed by material name. D.13 Phase 1 stores
   * 1D curves (single scan speed per material). Phase 2 extends to 2D.
   */
  responseCurves?: Record<string, ResponseCurve>;
}

const STORAGE_KEY = 'laserforge_device_profiles';
const ACTIVE_PROFILE_KEY = 'laserforge_active_profile';

/** Browser `localStorage`; absent in Node (tsx tests) and some embed contexts. */
function getBrowserLocalStorage(): Storage | null {
  if (typeof globalThis === 'undefined') return null;
  try {
    const ls = (globalThis as unknown as { localStorage?: unknown }).localStorage;
    if (
      ls != null &&
      typeof (ls as Storage).getItem === 'function' &&
      typeof (ls as Storage).setItem === 'function'
    ) {
      return ls as Storage;
    }
    return null;
  } catch {
    return null;
  }
}

/** Get all saved profiles */
export function getDeviceProfiles(): DeviceProfile[] {
  const ls = getBrowserLocalStorage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DeviceProfile[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(p => {
      const profile: DeviceProfile = {
        ...p,
        returnToOrigin: p.returnToOrigin ?? true,
        originCorner:
          (p as DeviceProfile).originCorner
          ?? (p.invertY === false ? 'rear-left' : 'front-left'),
      };
      return backfillFalconAutofocus(profile);
    });
  } catch {
    return [];
  }
}

/** Save a profile (create or update) */
export function saveDeviceProfile(profile: DeviceProfile): void {
  const ls = getBrowserLocalStorage();
  if (!ls) return;
  const profiles = getDeviceProfiles();
  const existingIdx = profiles.findIndex(p => p.id === profile.id);
  profile.updatedAt = new Date().toISOString();

  if (existingIdx >= 0) {
    profiles[existingIdx] = profile;
  } else {
    profile.createdAt = new Date().toISOString();
    profiles.push(profile);
  }

  ls.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

/** Delete a profile by ID */
export function deleteDeviceProfile(id: string): void {
  const ls = getBrowserLocalStorage();
  if (!ls) return;
  const profiles = getDeviceProfiles().filter(p => p.id !== id);
  ls.setItem(STORAGE_KEY, JSON.stringify(profiles));

  // Clear active if it was deleted
  if (getActiveProfileId() === id) {
    ls.removeItem(ACTIVE_PROFILE_KEY);
  }
}

/** Get the active profile ID */
export function getActiveProfileId(): string | null {
  const ls = getBrowserLocalStorage();
  if (!ls) return null;
  return ls.getItem(ACTIVE_PROFILE_KEY);
}

/** Set the active profile */
export function setActiveProfileId(id: string | null): void {
  const ls = getBrowserLocalStorage();
  if (!ls) return;
  if (id) {
    ls.setItem(ACTIVE_PROFILE_KEY, id);
  } else {
    ls.removeItem(ACTIVE_PROFILE_KEY);
  }
}

/** Get the active profile */
export function getActiveProfile(): DeviceProfile | null {
  const id = getActiveProfileId();
  if (!id) return null;
  return getDeviceProfiles().find(p => p.id === id) ?? null;
}

/** Create a new blank profile */
export function createBlankProfile(name: string): DeviceProfile {
  return {
    id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    machineType: 'diode',
    watts: 10,
    brand: '',
    model: '',
    bedWidth: 400,
    bedHeight: 400,
    originCorner: 'front-left',
    maxFeedRate: 6000,
    maxSpindle: 1000,
    homingEnabled: false,
    softLimitsEnabled: false,
    invertY: true,
    returnToOrigin: true,
    baudRate: 115200,
    startGcode: '',
    endGcode: '',
    gcodeHeaderTemplate: BUILT_IN_HEADER_TEMPLATES[DEFAULT_HEADER_TEMPLATE_NAME],
    gcodeFooterTemplate: BUILT_IN_FOOTER_TEMPLATES[DEFAULT_FOOTER_TEMPLATE_NAME],
    maxAccelMmPerS2: 1000,
    accelAwarePower: true,
    minPowerRatioAccel: 0.1,
    smartOverscanEnabled: true,
    overscanMm: 2.5,
  };
}

function isMachineType(v: string): v is DeviceProfile['machineType'] {
  return v === 'diode' || v === 'co2' || v === 'fiber';
}

/**
 * Backfill autofocus config for Falcon A1 Pro profiles that predate the
 * autofocus feature. Detection: brand === 'Creality' AND model contains
 * 'Falcon A1 Pro'. Only fills fields that are currently undefined — never
 * overwrites a user's explicit value, even if it's `false`. This means a
 * user who deliberately disabled autofocus stays disabled.
 *
 * Exported so the migration can be unit-tested without touching localStorage.
 */
export function backfillFalconAutofocus(profile: DeviceProfile): DeviceProfile {
  const isFalconA1Pro =
    profile.brand === 'Creality' &&
    typeof profile.model === 'string' &&
    profile.model.includes('Falcon A1 Pro');
  if (!isFalconA1Pro) return profile;

  const next: DeviceProfile = { ...profile };
  if (next.autoFocusSupported === undefined) {
    next.autoFocusSupported = true;
  }
  if (next.autoFocusCommand === undefined) {
    next.autoFocusCommand = '$HZ1';
  }
  if (next.autoFocusTimeoutMs === undefined) {
    next.autoFocusTimeoutMs = 15_000;
  }
  return next;
}

/**
 * Create a DeviceProfile pre-populated for a Falcon A1 Pro WiFi device.
 * Caller supplies the IP; connection metadata (model/firmware/laserInfo)
 * is attached after a successful test connection.
 *
 * Bed size 400×400 and 20W diode are Creality Falcon A1 Pro factory specs;
 * users can edit them in device settings like any other profile.
 */
export function createFalconWiFiProfile(name: string, ip: string): DeviceProfile {
  const base = createBlankProfile(name);
  return {
    ...base,
    brand: 'Creality',
    model: 'Falcon A1 Pro',
    machineType: 'diode',
    watts: 20,
    bedWidth: 400,
    bedHeight: 400,
    maxFeedRate: 6000,
    maxSpindle: 1000,
    autoFocusSupported: true,
    autoFocusCommand: '$HZ1',
    autoFocusTimeoutMs: 15_000,
    // GRBL-specific fields remain at defaults; they are ignored for falcon-wifi
    // but kept so existing code paths that look them up don't crash.
    connection: {
      kind: 'falcon-wifi',
      ip,
    },
  };
}

/**
 * Create a DeviceProfile pre-populated for a Falcon A1 Pro connected over
 * USB/serial. Includes the optical-rangefinder autofocus command ($HZ1,
 * Creality firmware extension requiring fw ≥ 1.0.38) so the Focus button
 * appears in the machine panel out of the box.
 *
 * Bed 400×400, 20W diode, front-left origin and 115200 baud GRBL-LPC are
 * Creality Falcon A1 Pro factory specs; users can edit them in device
 * settings like any other profile. No `connection` field is attached —
 * USB/serial profiles discover the port at connect time via port picker.
 */
export function createFalconSerialProfile(name: string = 'Creality Falcon A1 Pro'): DeviceProfile {
  const base = createBlankProfile(name);
  return {
    ...base,
    brand: 'Creality',
    model: 'Falcon A1 Pro',
    machineType: 'diode',
    watts: 20,
    bedWidth: 400,
    bedHeight: 400,
    originCorner: 'front-left',
    invertY: true,
    maxFeedRate: 6000,
    maxSpindle: 1000,
    baudRate: 115200,
    homingEnabled: true,
    softLimitsEnabled: true,
    autoFocusSupported: true,
    autoFocusCommand: '$HZ1',
    autoFocusTimeoutMs: 15_000,
  };
}

/** Create a profile from current scene machine settings */
export function profileFromScene(name: string, scene: Scene): DeviceProfile {
  const profile = createBlankProfile(name);
  const machine = scene.machine;

  const t = machine?.type ?? 'diode';
  profile.machineType = isMachineType(t) ? t : 'diode';
  profile.watts = parseInt(String(machine?.watts ?? '10'), 10) || 10;
  profile.brand = machine?.name ?? '';
  profile.model = '';
  profile.bedWidth = scene.canvas?.width ?? 400;
  profile.bedHeight = scene.canvas?.height ?? 400;

  return profile;
}

/** Apply a profile to scene machine settings */
export function applyProfileToScene(profile: DeviceProfile, scene: Scene): Scene {
  const name = [profile.brand, profile.model].filter(Boolean).join(' ').trim() || profile.name;
  return {
    ...scene,
    machine: {
      ...(scene.machine ?? { name: '', watts: '10', type: 'diode' }),
      name,
      type: profile.machineType,
      watts: String(profile.watts),
    },
    canvas: {
      ...scene.canvas,
      width: profile.bedWidth,
      height: profile.bedHeight,
    },
  };
}
