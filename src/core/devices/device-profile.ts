// DeviceProfile — the machine descriptor that controls bed bounds, max feed,
// laser-power scale, and coordinate origin. Used by JobCompiler to honor
// PROJECT.md non-negotiables #1 (bounds), #2 (origin), #7 (power-scale).

import type { CameraAlignment, CameraCalibration } from '../camera';
import type { RotarySetup } from './rotary';
import type { LaserFireControl } from './fire-control';
import type { ScanOffsetCalibrationStatus, ScanOffsetPoint } from './scan-offset-profile';
import type { GcodeDialectSelection } from './gcode-dialects';
import { DEFAULT_GRBL_RX_BUFFER_BYTES, type GrblStreamingMode } from '../grbl-streaming';
import type { CameraProfile } from '../camera';

export type Origin = 'front-left' | 'front-right' | 'rear-left' | 'rear-right' | 'center';
export type AirAssistCommand = 'none' | 'M7' | 'M8';
// Firmware families the app can drive (ADR-094). Each kind maps to a
// ControllerDriver in core/controllers; grblHAL and FluidNC share the GRBL
// protocol machinery with capability/code-table deltas, Marlin is a fully
// distinct dialect (no realtime bytes, queued M114 status, text errors).
export type ControllerKind =
  | 'grbl-v1.1'
  | 'grblhal'
  | 'fluidnc'
  | 'marlin'
  | 'smoothieware'
  | 'ruida';

/** Single source of truth for validators (catalog, .lfmachine shape, .lf2
 *  normalize). Grows in lockstep with the ControllerKind union. */
export const KNOWN_CONTROLLER_KINDS: ReadonlyArray<ControllerKind> = [
  'grbl-v1.1',
  'grblhal',
  'fluidnc',
  'marlin',
  'smoothieware',
  'ruida',
];

export function isKnownControllerKind(value: unknown): value is ControllerKind {
  return (KNOWN_CONTROLLER_KINDS as ReadonlyArray<unknown>).includes(value);
}

// Vendor command contracts are independent of a firmware-family label. The
// Falcon LightBurn device file disables $J jogging and settings fetch and
// supplies axis-specific Home commands; it does not identify a firmware build.
export type ControllerCommandSet = 'creality-falcon-a1-pro';

export function isControllerCommandSet(value: unknown): value is ControllerCommandSet {
  return value === 'creality-falcon-a1-pro';
}
export type LaserFocusMode = 'fixed-lever' | 'manual' | 'unknown';
export type LaserAirAssistHardware = 'built-in' | 'manual' | 'none' | 'unknown';
export type LaserTechnology = 'diode' | 'co2' | 'fiber' | 'unknown';
export type LaserHeadMetadataConfidence =
  | 'researched'
  | 'user-confirmed'
  | 'imported'
  | 'unverified';
export type MachineProfileSource = 'built-in' | 'custom' | 'imported' | 'lightburn';
export type ProfileCapability =
  | 'grbl'
  | 'wcs'
  | 'laser-output'
  | 'cnc-output'
  | 'air-assist'
  | 'no-go-zones'
  | 'scan-offsets'
  | 'verified-origin'
  | 'z-axis'
  | 'camera'
  | 'rotary'
  | 'low-power-fire';
export const PROFILE_CAPABILITIES = [
  'grbl',
  'wcs',
  'laser-output',
  'cnc-output',
  'air-assist',
  'no-go-zones',
  'scan-offsets',
  'verified-origin',
  'z-axis',
  'camera',
  'rotary',
  'low-power-fire',
] as const satisfies ReadonlyArray<ProfileCapability>;
export type ProfileEvidenceStatus =
  | 'default-starter'
  | 'hardware-verified'
  | 'simulator-tested'
  | 'public-spec-starter'
  | 'experimental'
  | 'user-imported'
  // Legacy values remain loadable in older .lf2/.lfmachine files.
  | 'default'
  | 'researched'
  | 'unverified';

export type ProfileEvidence = {
  readonly label: string;
  readonly status: ProfileEvidenceStatus;
  readonly note: string;
};

export type NoGoZone = {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type HomingConfig = {
  readonly enabled: boolean;
  readonly direction: Origin;
};

export type LaserSubProfile = {
  readonly model: string;
  readonly technology?: LaserTechnology;
  readonly metadataConfidence?: LaserHeadMetadataConfidence;
  readonly opticalPowerW?: number;
  readonly wavelengthNm?: number;
  readonly spotSizeMm?: {
    readonly x: number;
    readonly y: number;
  };
  readonly focusLengthMm?: number;
  readonly focusMode: LaserFocusMode;
  readonly airAssist: LaserAirAssistHardware;
  readonly notes?: string;
};

// Physical CNC values that belong to the machine rather than to one job.
// Stock, material, selected bit, and tiling remain project-specific in
// CncMachineConfig. Keeping this small block on DeviceProfile lets a machine
// with interchangeable laser/spindle toolheads retain both output contracts
// while the project still selects exactly one active compiler mode.
export type CncSubProfile = {
  readonly safeZMm: number;
  readonly spindleMaxRpm: number;
  readonly spindleSpinupSec: number;
  readonly coolant?: 'off' | 'mist' | 'flood';
  readonly parkXMm?: number;
  readonly parkYMm?: number;
};

export type DeviceMachineKind = 'laser' | 'cnc';
export type BidirectionalScanPolicy = 'allow-requested' | 'require-verified-offsets';

export function isBidirectionalScanPolicy(value: unknown): value is BidirectionalScanPolicy {
  return value === 'allow-requested' || value === 'require-verified-offsets';
}

export function effectiveBidirectionalScanPolicy(
  profile: Pick<DeviceProfile, 'bidirectionalScanPolicy' | 'gcodeDialect'>,
): BidirectionalScanPolicy {
  if (profile.bidirectionalScanPolicy !== undefined) return profile.bidirectionalScanPolicy;
  // Saved profiles predate the explicit capability. Preserve the established
  // 4040 safety behavior without making new policy depend on a dialect name.
  return profile.gcodeDialect.dialectId === 'neotronics-4040-safe'
    ? 'require-verified-offsets'
    : 'allow-requested';
}

export type DeviceProfile = {
  readonly name: string;
  readonly profileId?: string;
  readonly vendor?: string;
  readonly model?: string;
  readonly profileSource?: MachineProfileSource;
  readonly catalogVersion?: string;
  readonly capabilities?: ReadonlyArray<ProfileCapability>;
  readonly evidence?: ReadonlyArray<ProfileEvidence>;
  readonly machineFamily?: string;
  readonly controllerKind?: ControllerKind;
  readonly controllerCommandSet?: ControllerCommandSet;
  // Serial baud rate override. Absent = the controller driver's default
  // (GRBL family 115200; Marlin profiles typically 250000).
  readonly baudRate?: number;
  // GRBL serial streaming behavior. Most controllers work best with
  // char-counted streaming and a conservative 120-byte RX window; profiles can
  // opt into one-line ping-pong for controllers that misreport/free buffers.
  readonly streamingMode: GrblStreamingMode;
  readonly rxBufferBytes: number;
  /**
   * Opt in to reading the serial port and writing job refills inside a worker
   * (ADR-334), so a busy renderer cannot delay the acknowledgement round trip.
   * Off by default and unqualified: it has no runtime coverage in this
   * repository's test environment and no hardware evidence. A runtime that
   * cannot hand the port's streams to a worker silently keeps the main-thread
   * transport.
   */
  readonly workerHostedStreaming?: boolean;
  readonly gcodeDialect: GcodeDialectSelection;
  readonly laserSubProfile?: LaserSubProfile;
  readonly cncSubProfile?: CncSubProfile;
  readonly cameraProfile?: CameraProfile;
  // Bed dimensions in MILLIMETRES (not cm, not inches). Every consumer
  // — view-transform, draw-scene, origin-transform, grbl-strategy —
  // treats these as mm. G-code output is `G21` (mm). Reference work
  // areas: Creality Falcon A1 Pro = 358×268 mm (X×Y); Creality Falcon 2 =
  // 400×415 mm; xTool D1 Pro 20W = 430×390 mm. If you mistype this as
  // cm (40 instead of 400), nothing crashes — it just renders a tiny
  // bed and distort placement and bounds warnings.
  readonly bedWidth: number; // mm
  readonly bedHeight: number; // mm
  readonly maxFeed: number; // mm/min
  readonly maxPowerS: number; // GRBL $30 value (e.g. 1000)
  readonly minPowerS: number; // GRBL $31 value; normally 0 for diode lasers
  readonly laserModeEnabled: boolean; // GRBL $32; true means laser mode is enabled
  // GRBL coolant command wired to software-controlled air assist. LightBurn
  // exposes this as a device choice (M7 vs M8); default disabled because many
  // hobby controllers leave these pins unwired or use M7 only when compiled in.
  readonly airAssistCommand: AirAssistCommand;
  // Optional Z metadata. XY bed dimensions are used for bounds checks today;
  // Z is informational/setup-facing until a dedicated Z workflow is enabled.
  // Bidirectional fill/raster compensation. Empty keeps emitted output
  // unchanged until the operator calibrates a machine-specific table.
  readonly scanningOffsets: ReadonlyArray<ScanOffsetPoint>;
  // Profiles with physical bidirectional lag can require a verified table
  // before honoring requested bidirectional output. Absent retains the legacy
  // 4040-safe fallback and otherwise allows the requested direction.
  readonly bidirectionalScanPolicy?: BidirectionalScanPolicy;
  // Newly measured tables remain pending until the operator burns and
  // explicitly accepts a corrected verification coupon. Absent on a nonempty
  // legacy table preserves the historical calibrated behavior.
  readonly scanOffsetCalibrationStatus?: ScanOffsetCalibrationStatus | undefined;
  // Optional controlled laser-off seek feed. Absent keeps normal G0 rapid
  // positioning; a positive value emits explicit G1 F... S0 seeks.
  readonly controlledLaserOffTravelFeedMmPerMin?: number | undefined;
  // Overhead-camera de-fisheye calibration (ADR-107/108). Absent until the operator
  // runs the calibration wizard; persisted so the rectified overlay survives reload.
  readonly cameraCalibration?: CameraCalibration;
  // Camera→bed 4-point alignment (ADR-107). Absent until the operator aligns;
  // persisted so the workspace camera overlay survives reload.
  readonly cameraAlignment?: CameraAlignment;
  readonly noGoZones: ReadonlyArray<NoGoZone>;
  readonly zTravelMm?: number;
  readonly zTravelConfirmed?: boolean;
  readonly zProbePresent?: boolean;
  // Rotary attachment (ADR-127). Absent = no rotary configured; scaling
  // applies only while `rotary.enabled` — disabled output is byte-identical.
  readonly rotary?: RotarySetup;
  readonly fireControl?: LaserFireControl;
  // Feed used by the Frame button (jog around the job bounding box).
  // Separate from `maxFeed` so a user who lowers maxFeed to constrain
  // cut speeds doesn't also slow framing. The firmware still enforces its
  // own $110/$111 max-rate limits, but the app must not collapse this value
  // back to a low burn/feed setting.
  // 6000 mm/min matches LightBurn's default and most diode-laser
  // jog speeds from the Creality Falcon / xTool class.
  readonly framingFeedMmPerMin: number;
  // GRBL acceleration ($120/$121) in mm/sec². Used by the job-time
  // estimator's planner. Generic default of 500 sits in the middle of
  // the hobby/diode-laser range (real machines run 100-2500). Tune
  // per machine if estimates are systematically off. Phase D will
  // auto-read this from the `$$` settings dump on connect.
  readonly accelMmPerSec2: number;
  // GRBL junction deviation ($11) in mm. Controls cornering velocity:
  // larger → faster corners but more shake; smaller → slower corners,
  // smoother motion. Grbl's shipping default is 0.010 mm; rarely
  // overridden. Used by the planner's junction-velocity formula.
  readonly junctionDeviationMm: number;
  // Preview/ETA calibration factors derived from measured jobs. These affect
  // simulation time only, never emitted feed rates or machine motion. Absent
  // values preserve legacy profiles at an exact 1.0 scale.
  readonly estimateCutTimeScale?: number;
  readonly estimateTravelTimeScale?: number;
  readonly origin: Origin;
  readonly homing: HomingConfig;
  // One G-code or vendor-macro line the "Auto-focus" button sends through the
  // acknowledged interactive-command path. Multi-step G-code sequences are
  // intentionally unsupported; users need one firmware command/macro from
  // their controller documentation. Empty disables Auto-focus.
  readonly autofocusCommand: string;
};

export function explicitMachineKindsForProfile(
  profile: Pick<DeviceProfile, 'capabilities'>,
): ReadonlyArray<DeviceMachineKind> {
  const capabilities = profile.capabilities ?? [];
  return [
    ...(capabilities.includes('laser-output') ? (['laser'] as const) : []),
    ...(capabilities.includes('cnc-output') ? (['cnc'] as const) : []),
  ];
}

// Profiles saved before output capabilities existed remain unrestricted so
// old Laser/CNC projects do not become unstartable on load. Machine Setup
// converts that legacy ambiguity into an explicit selection on its next Save.
export function deviceSupportsMachineKind(
  profile: Pick<DeviceProfile, 'capabilities'>,
  machineKind: DeviceMachineKind,
): boolean {
  const explicit = explicitMachineKindsForProfile(profile);
  return explicit.length === 0 || explicit.includes(machineKind);
}

export const MIN_ESTIMATE_TIME_SCALE = 0.1;
export const MAX_ESTIMATE_TIME_SCALE = 5;

export function isEstimateTimeScale(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_ESTIMATE_TIME_SCALE &&
    value <= MAX_ESTIMATE_TIME_SCALE
  );
}

// Autofocus is intentionally blank by default.
//
// There is no portable autofocus G-code. Generic profiles leave this empty;
// model-specific profiles may supply a manufacturer-documented single command
// (the Falcon A1 Pro configuration supplies $HZ1). A multi-step probe routine
// is not a single autofocus macro. The UI accepts one documented command and
// disables Auto-focus while it is empty.
const DEFAULT_AUTOFOCUS_COMMAND = '';

// First-run default per WORKFLOW.md F-A1.
export const DEFAULT_DEVICE_PROFILE: DeviceProfile = {
  profileId: 'generic-grbl-400x400',
  vendor: 'Generic',
  model: 'GRBL 400x400',
  profileSource: 'built-in',
  catalogVersion: '2026-09-19',
  capabilities: ['grbl', 'wcs', 'verified-origin', 'scan-offsets', 'no-go-zones', 'rotary'],
  evidence: [
    {
      label: 'KerfDesk default',
      status: 'default-starter',
      note: 'Generic GRBL firmware template with unspecified machine and output kind. The 400 x 400 mm work area, S1000 scale and feed values are starter assumptions. Controller-reported configured travel does not measure usable work area. Confirm the fitted tool, firmware, homing and S range.',
    },
  ],
  name: 'Default 400×400',
  bedWidth: 400,
  bedHeight: 400,
  maxFeed: 6000,
  maxPowerS: 1000,
  minPowerS: 0,
  laserModeEnabled: true,
  airAssistCommand: 'none',
  streamingMode: 'char-counted',
  rxBufferBytes: DEFAULT_GRBL_RX_BUFFER_BYTES,
  gcodeDialect: { dialectId: 'grbl-dynamic' },
  scanningOffsets: [],
  bidirectionalScanPolicy: 'allow-requested',
  noGoZones: [],
  origin: 'front-left',
  homing: { enabled: false, direction: 'front-left' },
  autofocusCommand: DEFAULT_AUTOFOCUS_COMMAND,
  // Generic GRBL planner defaults. Tune per machine via Device
  // settings (Advanced) if burns systematically miss the ETA.
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  framingFeedMmPerMin: 6000,
};

export const NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'neotronics-4040-max-lt4lds-v2-20w',
  vendor: 'Neotronics',
  model: '4040 Max / LT-4LDS-V2 20W',
  name: 'Neotronics 4040 Max / LT-4LDS-V2 20W',
  catalogVersion: '2026-09-19',
  machineFamily: 'neotronics-4040-max',
  controllerKind: 'grbl-v1.1',
  bedWidth: 400,
  bedHeight: 400,
  maxFeed: 6000,
  maxPowerS: 1000,
  minPowerS: 0,
  laserModeEnabled: true,
  airAssistCommand: 'none',
  gcodeDialect: { dialectId: 'neotronics-4040-safe' },
  bidirectionalScanPolicy: 'require-verified-offsets',
  controlledLaserOffTravelFeedMmPerMin: 800,
  framingFeedMmPerMin: 2000,
  noGoZones: [],
  capabilities: [
    'grbl',
    'wcs',
    'laser-output',
    'cnc-output',
    'air-assist',
    'z-axis',
    'scan-offsets',
    'no-go-zones',
  ],
  evidence: [
    {
      label: 'Neotronics and LASER TREE public specifications',
      status: 'public-spec-starter',
      note: 'Public specifications checked 2026-09-19: 400 x 400 x 75 mm geometry; this combination assumes the separately specified 500 W / 12,000 RPM spindle, not the 710 W alternative. LT-4LDS-V2 optical data comes from LASER TREE. Sources: https://neotronics.co.za/index.php?product_id=1018&route=product%2Fproduct and https://lasertree.com/products/20w-optical-power-laser-cutting-module . Neither source establishes the combined controller revision or wiring. Confirm GRBL build, configured travel, usable work area, S scale, homing, feed limits, selector and air wiring.',
    },
  ],
  zTravelMm: 75,
  zTravelConfirmed: false,
  zProbePresent: true,
  cncSubProfile: {
    safeZMm: 3.81,
    spindleMaxRpm: 12000,
    spindleSpinupSec: 3,
    coolant: 'off',
  },
  laserSubProfile: {
    model: 'LASER TREE LT-4LDS-V2',
    technology: 'diode',
    metadataConfidence: 'researched',
    opticalPowerW: 20,
    wavelengthNm: 455,
    spotSizeMm: { x: 0.16, y: 0.18 },
    focusLengthMm: 40,
    focusMode: 'fixed-lever',
    airAssist: 'manual',
    notes:
      'The LT-4LDS-V2 has an integrated air nozzle, but public documentation does not show a controller-switched pump. Use an external/manual pump unless a specific M7/M8 relay is hardware-tested. Confirm GRBL settings, homing, selector wiring, safe Z, and installed spindle variant during setup.',
  },
};
