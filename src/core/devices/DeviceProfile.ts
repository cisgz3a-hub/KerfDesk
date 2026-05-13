/**
 * Device profiles — save/load machine configurations.
 * Users with multiple lasers can switch between them instantly.
 */

import { type Scene } from '../scene/Scene';
import { type ScanningOffsetTable } from '../job/ScanningOffset';
import { type ResponseCurve } from '../materials/ResponseCurve';
import { type OutputFormat } from '../output/Output';
import {
  BUILT_IN_FOOTER_TEMPLATES,
  BUILT_IN_HEADER_TEMPLATES,
  DEFAULT_FOOTER_TEMPLATE_NAME,
  DEFAULT_HEADER_TEMPLATE_NAME,
  LEGACY_FOOTER_BODY__PARK_AT_MAX_BED,
  LEGACY_FOOTER_BODY__WITH_BEEP,
} from '../plan/GcodeTemplates';
import { getStorage } from '../storage/storage';
import { validateProfile, type ProfileValidationIssue } from './validateProfile';

/** Physical home corner after GRBL homing ($23). Drives Y-flip for G-code vs canvas (Y-down). */
export type MachineOriginCorner = 'front-left' | 'rear-left' | 'front-right' | 'rear-right';

/**
 * Connection metadata for a DeviceProfile. When absent, profiles are treated as
 * the historical `serial` flavour (GRBL over USB). Falcon A1 Pro
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

export const DEFAULT_FRAME_DOT_FEED_RATE = 3000;

/**
 * T1-172 (audit F-017): per-line delay (ms) inserted between G-code
 * lines during the frame routine. 50 ms × 8 lines = 400 ms of inserted
 * delay regardless of feedrate. Pre-T1-172 this was hardcoded in
 * `ExecutionCoordinator.runFrame`. The audit
 * (docs/AUDIT-2026-05-11.md F-017) flagged it as Low-severity
 * Performance/Robustness: not safety-critical but adds noticeable
 * lag for short frames AND may not be enough for slow firmware.
 * Making it profile-driven lets fast firmware (Falcon A1 Pro at high
 * baud) drop toward 0 ms while leaving slow / shared-buffer firmware
 * room to raise it. The 50 ms default preserves shipped behavior for
 * profiles that do not set the field.
 */
export const DEFAULT_FRAME_LINE_DELAY_MS = 50;

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
  /**
   * Physical corner the head searches when Home ($H) runs. This may differ
   * from `originCorner` on machines with workspace offsets or negative
   * coordinates, so G-code transforms must continue to use `originCorner`.
   */
  homeCorner?: MachineOriginCorner;

  // GRBL settings
  maxFeedRate: number;     // mm/min
  maxSpindle: number;      // S-value (usually 255 or 1000)
  /** Low-power frame-dot / mark-center move feed rate. Defaults to 3000 mm/min. */
  frameDotFeedRate?: number;
  /**
   * T1-172 (audit F-017): per-line delay (ms) for the frame routine.
   * Defaults to {@link DEFAULT_FRAME_LINE_DELAY_MS} (50). Lower values
   * (e.g. 10) suit fast firmware; higher values (e.g. 100) suit slow
   * or shared-buffer firmware. Setting to 0 disables the delay.
   */
  frameLineDelayMs?: number;
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
   * When true, skip the WCS-mutation consent dialog on connect for this profile
   * and always apply the LaserForge GRBL baseline (G54=0, $10=0). Set from the
   * connect-time “don’t ask again” checkbox, or the Machine settings tab.
   */
  suppressWcsConsent?: boolean;

  /**
   * T3-90 (T1-25 follow-up): when true, send `M5 S0` after the connect-time
   * safe-state handshake (T1-25) reports a clean idle/FS:0,0 verdict.
   * Defense-in-depth on top of T1-22 (`safetyOff()`), T1-23 (pause/resume
   * M-state assertion), and T1-26 (footer M5) which already cover the
   * run-time cases. The connect-time gap is small: a controller can be
   * in M3/M4 modal mode with current S=0, T1-25 reports null verdict, and
   * a subsequent G1 starts firing at the gcode's S value. Defaults to
   * false so the contract does not surprise users who deliberately
   * preserve modal state across reconnects; opt-in lets diode users pin
   * connect-time behavior to "always start with laser off".
   *
   * Auto-M5 only fires when:
   *   - the active profile has `autoM5OnConnect === true`, AND
   *   - the controller's `getUnsafeAtConnect()` returns `null`
   *     (T1-25 verdict is clean — idle + FS:0,0).
   *
   * If the controller is in alarm/run/hold/door state at connect, the
   * verdict is non-null and auto-M5 does not fire (alarm requires
   * explicit recovery via `$X`, T2-129 territory).
   */
  autoM5OnConnect?: boolean;

  /**
   * When true, the machine workspace legitimately includes negative X/Y machine
   * or G-code coordinates (e.g. rear origin with G92/G10 offsets). When false
   * (default for new profiles and when omitted on load), negative output/travel
   * coordinates are preflight **errors** that block job start — typical for
   * front-origin diode lasers where negative means a limit risk.
   */
  allowsNegativeWorkspace?: boolean;

  /**
   * When true (default), any GRBL `error:N` during a job aborts the job. When
   * false, errors are surfaced but the stream attempts to continue. Set false
   * only if your firmware emits benign error codes in normal operation and you
   * accept the risk of continuing past real failures.
   */
  stopOnError?: boolean;

  /**
   * Optional connection metadata. When omitted, the profile is treated as
   * serial/GRBL (the historical shape). Present for Falcon A1 Pro WiFi
   * profiles so the UI can pick the correct connection & status widgets.
   */
  connection?: DeviceConnection;

  /**
   * T2-28: optional preferred output strategy/dialect for this profile.
   * When omitted, PipelineService resolves a target from controller
   * capabilities and falls back to the historical GRBL target.
   */
  outputFormat?: OutputFormat;
  outputDialect?: string;

  /**
   * Material response curves keyed by material name. D.13 Phase 1 stores
   * 1D curves (single scan speed per material). Phase 2 extends to 2D.
   */
  responseCurves?: Record<string, ResponseCurve>;
}

const STORAGE_KEY = 'laserforge_device_profiles';
const ACTIVE_PROFILE_KEY = 'laserforge_active_profile';

let cachedProfiles: DeviceProfile[] = [];
let cachedActiveId: string | null = null;
let initPromise: Promise<void> | null = null;

function applyProfileBackfills(p: DeviceProfile): DeviceProfile {
  const profile: DeviceProfile = {
    ...p,
    returnToOrigin: p.returnToOrigin ?? true,
    frameDotFeedRate: p.frameDotFeedRate ?? DEFAULT_FRAME_DOT_FEED_RATE,
    originCorner:
      (p as DeviceProfile).originCorner
      ?? (p.invertY === false ? 'rear-left' : 'front-left'),
  };
  profile.homeCorner = p.homeCorner ?? profile.originCorner;
  return backfillGcodeTemplateNames(backfillFalconAutofocus(profile));
}

export function resolveFrameDotFeedRate(
  profile: Pick<DeviceProfile, 'frameDotFeedRate'> | null | undefined,
): number {
  const value = profile?.frameDotFeedRate;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  return DEFAULT_FRAME_DOT_FEED_RATE;
}

/**
 * T1-172 (audit F-017): resolves the per-line delay (ms) for the
 * frame routine. Accepts 0 (disable delay) explicitly; falls back to
 * {@link DEFAULT_FRAME_LINE_DELAY_MS} when the profile value is
 * missing, non-finite, or negative.
 */
export function resolveFrameLineDelayMs(
  profile: Pick<DeviceProfile, 'frameLineDelayMs'> | null | undefined,
): number {
  const value = profile?.frameLineDelayMs;
  // 0 is a valid disable value, so accept it explicitly (the
  // `value > 0` check used for frameDotFeedRate would reject 0).
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  return DEFAULT_FRAME_LINE_DELAY_MS;
}

async function migrateDeviceProfilesFromLocalStorage(): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  const storage = getStorage();
  const keys = [STORAGE_KEY, ACTIVE_PROFILE_KEY];

  for (const key of keys) {
    try {
      const legacy = localStorage.getItem(key);
      if (legacy === null) continue;
      const existing = await storage.get(key);
      if (existing !== null) continue;
      await storage.set(key, legacy);
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

async function persistProfiles(): Promise<void> {
  try {
    await getStorage().set(STORAGE_KEY, JSON.stringify(cachedProfiles));
  } catch {
    /* ignore */
  }
}

async function runInitializeDeviceProfiles(): Promise<void> {
  await migrateDeviceProfilesFromLocalStorage();
  const storage = getStorage();

  try {
    const raw = await storage.get(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DeviceProfile[];
      if (Array.isArray(parsed)) {
        cachedProfiles = parsed.map(applyProfileBackfills);
      } else {
        cachedProfiles = [];
      }
    } else {
      cachedProfiles = [];
    }
  } catch {
    cachedProfiles = [];
  }

  try {
    cachedActiveId = await storage.get(ACTIVE_PROFILE_KEY);
  } catch {
    cachedActiveId = null;
  }
}

/** Load profiles from storage into the in-memory cache. Idempotent. */
export async function initializeDeviceProfiles(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = runInitializeDeviceProfiles();
  return initPromise;
}

/** Test-only cache reset for isolated profile-storage tests. */
export function resetDeviceProfilesForTest(): void {
  cachedProfiles = [];
  cachedActiveId = null;
  initPromise = null;
}

/** Get all saved profiles */
export function getDeviceProfiles(): DeviceProfile[] {
  return [...cachedProfiles];
}

/**
 * Save a profile (create or update).
 *
 * T2-39: validates the profile via `validateProfile` before persisting.
 * Hard-error issues (`severity: 'error'`) throw `ProfileValidationError`
 * naming the failing field, code, and message — caller's UI surface
 * must catch and render. Warnings (`severity: 'warning'`) are
 * `console.warn`'d but allowed through so legacy profiles imported with
 * marginal values (e.g. watts = 0 from an old export) don't deadlock
 * the save.
 *
 * The backfill / timestamp bump still runs after validation so a
 * rejected save doesn't mutate `updatedAt` on an in-memory profile that
 * was never persisted.
 */
export function saveDeviceProfile(profile: DeviceProfile): void {
  const validation = validateProfile(profile);
  if (!validation.ok) {
    const errors = validation.issues.filter(i => i.severity === 'error');
    throw new ProfileValidationError(
      `Cannot save profile: ${errors.length} validation error(s).`,
      validation.issues,
    );
  }
  for (const w of validation.issues.filter(i => i.severity === 'warning')) {
    console.warn(`[T2-39] Profile "${profile.name}" save warning: ${w.field} - ${w.message}`);
  }

  const existingIdx = cachedProfiles.findIndex(p => p.id === profile.id);
  const nextProfile = applyProfileBackfills({
    ...profile,
    updatedAt: new Date().toISOString(),
  });

  if (existingIdx >= 0) {
    cachedProfiles[existingIdx] = nextProfile;
  } else {
    nextProfile.createdAt = new Date().toISOString();
    cachedProfiles.push(nextProfile);
  }
  void persistProfiles();
}

/**
 * T2-39: thrown by {@link saveDeviceProfile} when the profile fails
 * `validateProfile`. The `issues` array is the raw validator output
 * so a UI surface can render per-field errors.
 */
export class ProfileValidationError extends Error {
  readonly issues: ProfileValidationIssue[];
  constructor(message: string, issues: ProfileValidationIssue[]) {
    super(message);
    this.name = 'ProfileValidationError';
    this.issues = issues;
  }
}

/** Delete a profile by ID */
export function deleteDeviceProfile(id: string): void {
  cachedProfiles = cachedProfiles.filter(p => p.id !== id);
  void persistProfiles();

  // Clear active if it was deleted
  if (getActiveProfileId() === id) {
    cachedActiveId = null;
    void getStorage().remove(ACTIVE_PROFILE_KEY).catch(() => {
      /* ignore */
    });
  }
}

/** Get the active profile ID */
export function getActiveProfileId(): string | null {
  return cachedActiveId;
}

/** Set the active profile */
export function setActiveProfileId(id: string | null): void {
  cachedActiveId = id;
  if (id) {
    void getStorage().set(ACTIVE_PROFILE_KEY, id).catch(() => {
      /* ignore */
    });
  } else {
    void getStorage().remove(ACTIVE_PROFILE_KEY).catch(() => {
      /* ignore */
    });
  }
}

/** Get the active profile */
export function getActiveProfile(): DeviceProfile | null {
  if (!cachedActiveId) return null;
  return cachedProfiles.find(p => p.id === cachedActiveId) ?? null;
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
    homeCorner: 'front-left',
    maxFeedRate: 6000,
    maxSpindle: 1000,
    frameDotFeedRate: DEFAULT_FRAME_DOT_FEED_RATE,
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
 * Heal autofocus config for Falcon A1 Pro profiles. These fields are
 * firmware capability, not user preference, so they're restored to
 * correct values on every profile load regardless of prior state.
 * Older builds may have persisted autoFocusSupported=false or stale
 * commands in localStorage; this migration corrects that.
 *
 * Detection: brand === 'Creality' AND model contains 'Falcon A1 Pro'.
 * Non-Falcon profiles are returned unchanged.
 *
 * Exported so the migration can be unit-tested without touching
 * localStorage.
 */
/**
 * T3-55: Falcon autofocus minimum firmware version. The `$HZ1` command
 * was added in 1.0.38; older firmware emits `error:20` on the line and
 * the autofocus probe never moves. When we can read the firmware version
 * via T3-50's `DeviceIdentity`, refuse to flip `autoFocusSupported: true`
 * on a profile whose hardware reports an older version.
 */
export const FALCON_AUTOFOCUS_MIN_FIRMWARE = '1.0.38';

/**
 * T3-55: parse a GRBL-style firmware version string into a comparable
 * triple. Handles `1.0.38`, `1.1h.20221128`, `1.0.38:Falcon`, and other
 * forks; strips a trailing `:tag` suffix; treats a letter suffix on the
 * patch component (`1.1h`) as the patch number with a fractional letter
 * weight so `1.1h` > `1.1` and `1.1i` > `1.1h`. Returns `null` when the
 * string cannot be parsed — caller treats `null` as "version unknown,
 * fall through to optimistic heal so the existing UI gating
 * (T1-55 / T3-56) still protects the user".
 */
export function parseFirmwareVersion(version: string): { major: number; minor: number; patch: number } | null {
  if (typeof version !== 'string') return null;
  // Strip trailing `:tag` build-name suffix and surrounding whitespace.
  const trimmed = version.replace(/:.*$/, '').trim();
  // Match `MAJOR.MINOR[.PATCH][LETTER]` plus optional `.YYYYMMDD` build date.
  const match = trimmed.match(/^(\d+)\.(\d+)(?:\.(\d+))?([a-z])?(?:\.\d+)?$/i);
  if (!match) return null;
  const major = parseInt(match[1]!, 10);
  const minor = parseInt(match[2]!, 10);
  const patchNum = match[3] !== undefined ? parseInt(match[3], 10) : 0;
  const letter = match[4]?.toLowerCase();
  // Letter suffix on the patch component (`1.1h`) sorts after the
  // letter-less patch (`1.1`) and before the next letter (`1.1i`). Use
  // a fractional offset so 1.1h.20221128 < 1.1i.20221128 < 1.2.0.
  const letterOffset = letter ? (letter.charCodeAt(0) - 'a'.charCodeAt(0) + 1) / 100 : 0;
  return { major, minor, patch: patchNum + letterOffset };
}

/**
 * T3-55: returns `true` iff `version >= minimum`. Returns `false` when
 * `version` cannot be parsed — refusing on parse failure is the
 * conservative choice. Public so preflight and tests can reuse it.
 */
export function firmwareVersionAtLeast(version: string, minimum: string): boolean {
  const v = parseFirmwareVersion(version);
  const m = parseFirmwareVersion(minimum);
  if (v == null || m == null) return false;
  if (v.major !== m.major) return v.major > m.major;
  if (v.minor !== m.minor) return v.minor > m.minor;
  return v.patch >= m.patch;
}

/**
 * T3-55: heal Falcon A1 Pro autofocus fields, but consult live firmware
 * version when available. The version comes from the T3-50
 * `DeviceIdentity.firmwareVersion` snapshot. When the version is
 * supplied AND parses AND is below the `$HZ1` minimum, mark autofocus
 * unsupported so the Focus button stays hidden. When the version is
 * supplied AND at or above the minimum, heal optimistically. When the
 * version is missing or unparseable, the existing optimistic heal still
 * runs — this preserves the pre-T3-55 behavior so a fresh profile load
 * before connect doesn't lose autofocus support; the broader
 * "capabilities unknown while connected" gate (T1-55 / T3-56) still
 * blocks the actual `$HZ1` send when the controller hasn't reported
 * its firmware yet.
 */
export function backfillFalconAutofocus(
  profile: DeviceProfile,
  controllerFirmwareVersion?: string | null,
): DeviceProfile {
  const isFalconA1Pro =
    profile.brand === 'Creality' &&
    typeof profile.model === 'string' &&
    profile.model.includes('Falcon A1 Pro');
  if (!isFalconA1Pro) return profile;

  // Heal autofocus fields for Falcon A1 Pro. These values are
  // firmware-dictated, not user preferences:
  //   - autoFocusSupported: true (Falcon A1 Pro supports $HZ1 since fw 1.0.38)
  //   - autoFocusCommand:   '$HZ1' (the correct GRBL-LPC command for this hardware)
  //   - autoFocusTimeoutMs: 15_000 (empirically validated timeout)
  // Older builds may have written stale values; we overwrite them on every load.
  if (typeof controllerFirmwareVersion === 'string' && controllerFirmwareVersion.length > 0) {
    const ok = firmwareVersionAtLeast(controllerFirmwareVersion, FALCON_AUTOFOCUS_MIN_FIRMWARE);
    if (!ok) {
      return {
        ...profile,
        autoFocusSupported: false,
        autoFocusCommand: '',
        autoFocusTimeoutMs: 0,
      };
    }
  }

  return {
    ...profile,
    autoFocusSupported: true,
    autoFocusCommand: '$HZ1',
    autoFocusTimeoutMs: 15_000,
  };
}

/** On load, rewrite pre–T0-2 built-in footer body strings to current built-ins. */
export function backfillGcodeTemplateNames(profile: DeviceProfile): DeviceProfile {
  const t = profile.gcodeFooterTemplate;
  if (t === LEGACY_FOOTER_BODY__PARK_AT_MAX_BED) {
    return { ...profile, gcodeFooterTemplate: BUILT_IN_FOOTER_TEMPLATES['Park near far corner'] };
  }
  if (t === LEGACY_FOOTER_BODY__WITH_BEEP) {
    return { ...profile, gcodeFooterTemplate: BUILT_IN_FOOTER_TEMPLATES['With completion marker'] };
  }
  return profile;
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
    allowsNegativeWorkspace: false,
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
    homeCorner: 'front-left',
    invertY: true,
    maxFeedRate: 6000,
    maxSpindle: 1000,
    baudRate: 115200,
    homingEnabled: true,
    softLimitsEnabled: true,
    autoFocusSupported: true,
    autoFocusCommand: '$HZ1',
    autoFocusTimeoutMs: 15_000,
    allowsNegativeWorkspace: false,
  };
}

/**
 * Create a conservative profile for PRTCNC PRT4040 CNC routers fitted with a
 * laser module. These machines can be GRBL-compatible, but their homing,
 * limit-switch, and coordinate assumptions are closer to CNC routers than
 * Falcon-style diode gantries. Start in manual-zero mode until the real
 * controller settings are known.
 */
export function createPrt4040RouterLaserProfile(
  name: string = 'PRTCNC PRT4040',
): DeviceProfile {
  const base = createBlankProfile(name);
  return {
    ...base,
    brand: 'PRTCNC',
    model: 'PRT4040 router + laser',
    machineType: 'diode',
    watts: 20,
    bedWidth: 400,
    bedHeight: 400,
    originCorner: 'rear-right',
    homeCorner: 'rear-right',
    invertY: false,
    maxFeedRate: 1500,
    maxSpindle: 1000,
    baudRate: 115200,
    homingEnabled: false,
    softLimitsEnabled: false,
    returnToOrigin: false,
    autoFocusSupported: false,
    autoFocusCommand: undefined,
    autoFocusTimeoutMs: undefined,
    allowsNegativeWorkspace: true,
  };
}

export function isPrt4040RouterLaserProfile(
  profile: DeviceProfile | null | undefined,
): boolean {
  if (!profile) return false;
  return profile.brand === 'PRTCNC' && /PRT\s*4040|PRT4040/i.test(profile.model);
}

export function shouldDefaultStartModeToCurrentForProfile(
  profile: DeviceProfile | null | undefined,
): boolean {
  return isPrt4040RouterLaserProfile(profile);
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
