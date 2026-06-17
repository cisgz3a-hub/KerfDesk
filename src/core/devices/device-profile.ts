// DeviceProfile — the machine descriptor that controls bed bounds, max feed,
// laser-power scale, and coordinate origin. Used by JobCompiler to honor
// PROJECT.md non-negotiables #1 (bounds), #2 (origin), #7 (power-scale).

export type Origin = 'front-left' | 'front-right' | 'rear-left' | 'rear-right' | 'center';
export type AirAssistCommand = 'none' | 'M7' | 'M8';
export type ControllerKind = 'grbl-v1.1';
export type LaserFocusMode = 'fixed-lever' | 'manual' | 'unknown';
export type LaserAirAssistHardware = 'built-in' | 'manual' | 'none' | 'unknown';
export type GrblStreamingMode = 'char-counted' | 'ping-pong';
export type GrblPollDuringJob = 'off' | '1hz' | '2hz' | '4hz';
export type GrblLaserModeCommand = 'M3' | 'M4' | 'mixed';

export type HomingConfig = {
  readonly enabled: boolean;
  readonly direction: Origin;
};

export type MachineProfileSource = 'built-in' | 'custom' | 'imported-lightburn' | 'diagnostic';

export type ProfileCapability =
  | 'grbl'
  | 'homing'
  | 'wcs'
  | 'air-assist'
  | 'z-axis'
  | 'no-go-zones'
  | 'rotary-ready'
  | 'camera-ready';

export type ProfileEvidenceStatus = 'verified' | 'researched' | 'starter' | 'user-imported';

export type ProfileEvidence = {
  readonly label: string;
  readonly status: ProfileEvidenceStatus;
  readonly note: string;
  readonly source?: string;
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

export type LaserSubProfile = {
  readonly model: string;
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

export type DeviceControllerCompatibility = {
  readonly baudRate: number;
  readonly rxBufferBytes: number;
  readonly streamingMode: GrblStreamingMode;
  readonly pollDuringJob: GrblPollDuringJob;
  readonly requiresHomingBeforeJob: boolean;
  readonly supportsStatusBufferReport: boolean;
  readonly supportsWcs: boolean;
  readonly safeModeDefault: boolean;
};

export type DeviceGcodeDialect = {
  readonly dialectId: string;
  readonly returnToOriginOnEnd: boolean;
  readonly emitSOnTravel: boolean;
  // When set, laser-off positioning moves are emitted as feed-controlled
  // `G1 ... F... S0` instead of uncontrolled `G0 ... S0`. This is slower, but
  // protects controllers/gantries that lose steps on aggressive rapid moves.
  readonly controlledLaserOffTravelFeedMmPerMin?: number | undefined;
  readonly emitSOnEveryBurnMove: boolean;
  readonly modalFeedrate: boolean;
  readonly airAssistCommand: AirAssistCommand;
  readonly laserModeCommand: GrblLaserModeCommand;
};

export type DeviceProfile = {
  readonly profileId?: string;
  readonly vendor?: string;
  readonly model?: string;
  readonly profileSource?: MachineProfileSource;
  readonly catalogVersion?: string;
  readonly capabilities?: ReadonlyArray<ProfileCapability>;
  readonly evidence?: ReadonlyArray<ProfileEvidence>;
  readonly name: string;
  readonly machineFamily?: string;
  readonly controllerKind?: ControllerKind;
  readonly laserSubProfile?: LaserSubProfile;
  readonly controller: DeviceControllerCompatibility;
  readonly gcodeDialect: DeviceGcodeDialect;
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
  readonly noGoZones?: ReadonlyArray<NoGoZone>;
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
  capabilities: ['grbl', 'wcs', 'no-go-zones'],
  evidence: [
    {
      label: 'LaserForge starter profile',
      status: 'starter',
      note: 'Conservative 400x400 mm GRBL defaults for first-run setup and manual confirmation.',
    },
  ],
  name: 'Default 400×400',
  machineFamily: 'generic-grbl-400x400',
  controllerKind: 'grbl-v1.1',
  controller: {
    baudRate: 115200,
    rxBufferBytes: 120,
    streamingMode: 'char-counted',
    pollDuringJob: '4hz',
    requiresHomingBeforeJob: false,
    supportsStatusBufferReport: true,
    supportsWcs: true,
    safeModeDefault: false,
  },
  gcodeDialect: {
    dialectId: 'creality-falcon-compatible',
    returnToOriginOnEnd: true,
    emitSOnTravel: true,
    emitSOnEveryBurnMove: false,
    modalFeedrate: true,
    airAssistCommand: 'none',
    laserModeCommand: 'mixed',
  },
  bedWidth: 400,
  bedHeight: 400,
  maxFeed: 6000,
  maxPowerS: 1000,
  minPowerS: 0,
  laserModeEnabled: true,
  airAssistCommand: 'none',
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
  capabilities: ['grbl', 'homing', 'wcs', 'air-assist', 'z-axis', 'no-go-zones'],
  evidence: [
    {
      label: 'User diagnostic profile',
      status: 'researched',
      note: 'Based on local 4040 diagnostic work: GRBL-like controller, LT-4LDS-V2 20W head, conservative streaming, and feed-controlled travel.',
    },
  ],
  controller: {
    ...DEFAULT_DEVICE_PROFILE.controller,
    rxBufferBytes: 80,
    streamingMode: 'ping-pong',
    pollDuringJob: 'off',
    requiresHomingBeforeJob: true,
    supportsStatusBufferReport: false,
    safeModeDefault: true,
  },
  gcodeDialect: {
    ...DEFAULT_DEVICE_PROFILE.gcodeDialect,
    dialectId: 'neotronics-4040-safe',
    returnToOriginOnEnd: false,
    emitSOnEveryBurnMove: true,
    modalFeedrate: false,
    controlledLaserOffTravelFeedMmPerMin: 800,
    laserModeCommand: 'M4',
  },
  bedWidth: 400,
  bedHeight: 400,
  maxFeed: 6000,
  maxPowerS: 1000,
  minPowerS: 0,
  laserModeEnabled: true,
  airAssistCommand: 'none',
  homing: { enabled: true, direction: 'front-left' },
  zTravelMm: 75,
  zTravelConfirmed: false,
  zProbePresent: true,
  laserSubProfile: {
    model: 'LASER TREE LT-4LDS-V2',
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
