// ControllerCapabilities — the declarative surface the UI gates on. Components
// and store guards read these flags, NEVER `kind === 'grbl'` (the controller
// equivalent of the banned platform-conditional anti-pattern). Every value is
// data, so a capabilities snapshot can live in Zustand state.

export type JogCapability =
  // Native jog protocol with its own queue (GRBL `$J=`), cancellable without
  // touching the planner.
  | 'native-jog'
  // No jog protocol: jogging is plain relative G0 moves (Marlin, Smoothie).
  | 'gcode-relative'
  | 'none';

export type StatusQueryCapability =
  // Single-byte realtime report (`?` → `<Idle|MPos:...>`), pollable mid-job.
  | 'realtime-report'
  // Position query goes through the command queue (Marlin M114) — poll only
  // while idle; job progress comes from the streamer instead.
  | 'queued-poll'
  | 'none';

export type SettingsCapability =
  // `$$` dump + `$N=value` guarded writes (GRBL family).
  | 'grbl-dollar'
  // Read-only settings dump (Marlin M503); no in-app writes.
  | 'readonly-dump'
  | 'none';

export type WcsCapability = 'g92-and-g10' | 'g92-only' | 'none';

export type FirmwareSetupPanel = 'grbl-laser' | 'none';

export type ControllerCapabilities = {
  readonly jog: JogCapability;
  readonly jogCancel: boolean;
  // `!` / `~` realtime feed hold. false ⇒ pause is stream-side only (stop
  // sending; buffered motion drains) and the UI must say so.
  readonly realtimePause: boolean;
  // Realtime soft reset / abort byte exists (GRBL \x18).
  readonly softStop: boolean;
  readonly statusQuery: StatusQueryCapability;
  readonly settings: SettingsCapability;
  readonly unlock: boolean;
  readonly sleep: boolean;
  readonly wcs: WcsCapability;
  readonly homing: boolean;
  readonly console: boolean;
  readonly firmwareSetupPanel: FirmwareSetupPanel;
};
