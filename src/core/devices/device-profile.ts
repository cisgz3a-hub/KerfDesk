// DeviceProfile — the machine descriptor that controls bed bounds, max feed,
// laser-power scale, and coordinate origin. Used by JobCompiler to honor
// PROJECT.md non-negotiables #1 (bounds), #2 (origin), #7 (power-scale).

import type { CameraAlignment, CameraCalibration } from '../camera';
import type { ScanOffsetPoint } from './scan-offset-profile';
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
  | 'air-assist'
  | 'no-go-zones'
  | 'scan-offsets'
  | 'verified-origin'
  | 'z-axis'
  | 'camera';
export const PROFILE_CAPABILITIES = [
  'grbl',
  'wcs',
  'air-assist',
  'no-go-zones',
  'scan-offsets',
  'verified-origin',
  'z-axis',
  'camera',
] as const satisfies ReadonlyArray<ProfileCapability>;
export type ProfileEvidenceStatus = 'default' | 'researched' | 'user-imported' | 'unverified';

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
  // Serial baud rate override. Absent = the controller driver's default
  // (GRBL family 115200; Marlin profiles typically 250000).
  readonly baudRate?: number;
  // GRBL serial streaming behavior. Most controllers work best with
  // char-counted streaming and a conservative 120-byte RX window; profiles can
  // opt into one-line ping-pong for controllers that misreport/free buffers.
  readonly streamingMode: GrblStreamingMode;
  readonly rxBufferBytes: number;
  readonly gcodeDialect: GcodeDialectSelection;
  readonly laserSubProfile?: LaserSubProfile;
  readonly cameraProfile?: CameraProfile;
  // Bed dimensions in MILLIMETRES (not cm, not inches). Every consumer
  // — view-transform, draw-scene, origin-transform, grbl-strategy —
  // treats these as mm. G-code output is `G21` (mm). Reference work
  // areas: Creality Falcon A1 Pro = 400×400 mm; Creality Falcon 2 =
  // 400×415 mm; xTool D1 Pro 20W = 430×390 mm. If you mistype this as
  // cm (40 instead of 400), nothing crashes — it just renders a tiny
  // bed and the framer/bounds checks will reject most jobs.
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
  // Feed used by the Frame button (jog around the job bounding box).
  // Separate from `maxFeed` so a user who lowers maxFeed to constrain
  // cut speeds doesn't also slow framing. Capped at maxFeed at
  // emit time so we never command past the machine's safe rate.
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
  readonly origin: Origin;
  readonly homing: HomingConfig;
  // Multi-line G-code (or vendor M-code) sequence the "Auto-focus" button
  // sends. Lines are sent in order via the streaming buffer. Default is a
  // standard GRBL probe-and-offset pattern; users on machines with custom
  // autofocus protocols (Creality Falcon's M2010, xTool's vendor codes,
  // proprietary touch-probe sequences) paste their machine's command here.
  readonly autofocusCommand: string;
};

// Autofocus is intentionally blank by default.
//
// Field reality check: there is no portable autofocus G-code. Real-world
// behavior we've seen:
//   * GRBL with Z + probe pin  → `G38.2 Z-30 F100; G92 Z0; G1 Z3 F600` works.
//   * GrblHAL on diode lasers   → rejects G38.2 with `error:20` (unsupported)
//     and on some boards (Creality Falcon "A1 Pro Laser Master", xTool) the
//     firmware beeps loudly and aborts the line — actively bad UX.
//   * Creality Falcon stock     → focus is mechanical (head height ring); no
//     command exists. CrealityPrint doesn't send one.
//   * xTool                     → vendor-specific M-codes that vary by model.
//
// Shipping any "default" we picked would break someone's machine, so the
// default is empty and the UI tells the user to paste their machine's
// command. The Auto-focus button is disabled while this is empty (see the
// laser store's `autofocus` action).
const DEFAULT_AUTOFOCUS_COMMAND = '';

// First-run default per WORKFLOW.md F-A1.
export const DEFAULT_DEVICE_PROFILE: DeviceProfile = {
  profileId: 'generic-grbl-400x400',
  vendor: 'Generic',
  model: 'GRBL 400x400',
  profileSource: 'built-in',
  catalogVersion: '2026-06-17',
  capabilities: ['grbl', 'wcs', 'verified-origin', 'scan-offsets', 'no-go-zones'],
  evidence: [
    {
      label: 'KerfDesk default',
      status: 'default',
      note: 'Starter GRBL profile. Confirm bed size, homing, and S range before first job.',
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
  framingFeedMmPerMin: 2000,
  noGoZones: [],
  capabilities: ['grbl', 'wcs', 'air-assist', 'verified-origin', 'scan-offsets', 'no-go-zones'],
  evidence: [
    {
      label: 'User-provided 4040 profile',
      status: 'researched',
      note: '400x400 XY and LT-4LDS-V2 20W laser metadata captured for the Neotronics 4040 class.',
    },
  ],
  zTravelMm: 75,
  zTravelConfirmed: false,
  zProbePresent: true,
  laserSubProfile: {
    model: 'LASER TREE LT-4LDS-V2',
    technology: 'diode',
    metadataConfidence: 'researched',
    opticalPowerW: 20,
    wavelengthNm: 455,
    spotSizeMm: { x: 0.16, y: 0.18 },
    focusLengthMm: 40,
    focusMode: 'fixed-lever',
    airAssist: 'built-in',
    notes:
      'Neotronics/OEM documents 400x400 XY and 75 mm Z, but related 4040 variants list 95 mm Z. Confirm Z travel and air-assist wiring during setup.',
  },
};
