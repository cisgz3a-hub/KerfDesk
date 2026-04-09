/**
 * Device profiles — save/load machine configurations.
 * Users with multiple lasers can switch between them instantly.
 */

import { type Scene } from '../scene/Scene';

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

  // GRBL settings
  maxFeedRate: number;     // mm/min
  maxSpindle: number;      // S-value (usually 255 or 1000)
  homingEnabled: boolean;
  softLimitsEnabled: boolean;
  invertY: boolean;

  // Connection
  baudRate: number;
  preferredPort?: string;

  // Custom G-code
  startGcode: string;
  endGcode: string;
}

const STORAGE_KEY = 'laserforge_device_profiles';
const ACTIVE_PROFILE_KEY = 'laserforge_active_profile';

/** Get all saved profiles */
export function getDeviceProfiles(): DeviceProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Save a profile (create or update) */
export function saveDeviceProfile(profile: DeviceProfile): void {
  const profiles = getDeviceProfiles();
  const existingIdx = profiles.findIndex(p => p.id === profile.id);
  profile.updatedAt = new Date().toISOString();

  if (existingIdx >= 0) {
    profiles[existingIdx] = profile;
  } else {
    profile.createdAt = new Date().toISOString();
    profiles.push(profile);
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

/** Delete a profile by ID */
export function deleteDeviceProfile(id: string): void {
  const profiles = getDeviceProfiles().filter(p => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));

  // Clear active if it was deleted
  if (getActiveProfileId() === id) {
    localStorage.removeItem(ACTIVE_PROFILE_KEY);
  }
}

/** Get the active profile ID */
export function getActiveProfileId(): string | null {
  return localStorage.getItem(ACTIVE_PROFILE_KEY);
}

/** Set the active profile */
export function setActiveProfileId(id: string | null): void {
  if (id) {
    localStorage.setItem(ACTIVE_PROFILE_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_PROFILE_KEY);
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
    maxFeedRate: 6000,
    maxSpindle: 1000,
    homingEnabled: false,
    softLimitsEnabled: false,
    invertY: false,
    baudRate: 115200,
    startGcode: 'G21\nG90\nM4 S0',
    endGcode: 'M5\nG0 X0 Y0',
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
