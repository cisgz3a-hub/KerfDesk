/**
 * Device profiles — save/load machine configurations.
 * Users with multiple lasers can switch between them instantly.
 */

import { type Scene } from '../scene/Scene';
import { type ScanningOffsetTable } from '../plan/ScanningOffset';

/** Physical home corner after GRBL homing ($23). Drives Y-flip for G-code vs canvas (Y-down). */
export type MachineOriginCorner = 'front-left' | 'rear-left' | 'front-right' | 'rear-right';

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

  /** Max acceleration mm/s² (GRBL-style). Used for raster power vs velocity. */
  maxAccelMmPerS2?: number;
  /** Default acceleration-aware raster power when layer does not override. */
  accelAwarePower?: boolean;
  /** Default minimum power ratio during raster decel. */
  minPowerRatioAccel?: number;

  /** Scanning offset calibration table for compensating laser firing latency. */
  scanningOffsets?: ScanningOffsetTable;
}

const STORAGE_KEY = 'laserforge_device_profiles';
const ACTIVE_PROFILE_KEY = 'laserforge_active_profile';

/** Browser `localStorage`; absent in Node (tsx tests) and some embed contexts. */
function getBrowserLocalStorage(): Storage | null {
  if (typeof globalThis === 'undefined') return null;
  try {
    const ls = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    return ls ?? null;
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
    return parsed.map(p => ({
      ...p,
      returnToOrigin: p.returnToOrigin ?? true,
      originCorner:
        (p as DeviceProfile).originCorner
        ?? (p.invertY === false ? 'rear-left' : 'front-left'),
    }));
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
    maxAccelMmPerS2: 1000,
    accelAwarePower: true,
    minPowerRatioAccel: 0.1,
  };
}

function isMachineType(v: string): v is DeviceProfile['machineType'] {
  return v === 'diode' || v === 'co2' || v === 'fiber';
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
