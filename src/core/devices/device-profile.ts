// DeviceProfile — the machine descriptor that controls bed bounds, max feed,
// laser-power scale, and coordinate origin. Used by JobCompiler to honor
// PROJECT.md non-negotiables #1 (bounds), #2 (origin), #7 (power-scale).

export type Origin = 'front-left' | 'front-right' | 'rear-left' | 'rear-right' | 'center';

export type HomingConfig = {
  readonly enabled: boolean;
  readonly direction: Origin;
};

export type DeviceProfile = {
  readonly name: string;
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
  name: 'Default 400×400',
  bedWidth: 400,
  bedHeight: 400,
  maxFeed: 6000,
  maxPowerS: 1000,
  origin: 'front-left',
  homing: { enabled: false, direction: 'front-left' },
  autofocusCommand: DEFAULT_AUTOFOCUS_COMMAND,
};
