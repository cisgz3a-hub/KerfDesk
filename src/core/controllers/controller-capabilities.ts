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

export type TransportCapability =
  // Live serial link (Web Serial / Electron serial): connect, jog, stream.
  | 'serial'
  // No live link in this build — jobs are exported as files (Ruida .rd);
  // the Connect button and machine controls are disabled for the profile.
  | 'file-only';

export type StartProtocolCapability = 'grbl-live' | 'marlin-line' | 'smoothie-live' | 'file-only';

export type ControllerCapabilities = {
  // Compatibility class for live Start semantics. Controller labels may
  // differ while queue, status, realtime, and emitted-job contracts match.
  readonly startProtocol: StartProtocolCapability;
  readonly transport: TransportCapability;
  readonly jog: JogCapability;
  readonly jogCancel: boolean;
  // `!` / `~` realtime feed hold. false ⇒ pause is stream-side only (stop
  // sending; buffered motion drains) and the UI must say so.
  readonly realtimePause: boolean;
  // Stream-side pause also queues a beam-off behind the buffered motion, and
  // Resume switches the beam back on in the program's own commands (Marlin,
  // driver.planStreamPauseBeam). Absent means false.
  readonly streamPauseBeamOff?: boolean;
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
  // G38.2 touch-plate probing. The probe protocol runner speaks the GRBL
  // response grammar (ok pacing, ALARM:4/5, <status>), so only GRBL-family
  // firmwares may expose probe UI — a different grammar could report false
  // success and zero Z at the wrong height.
  readonly probing: boolean;
  // CNC spindle jobs (ADR-098: CNC is GRBL-only). The CNC emitter speaks the
  // GRBL dialect — e.g. G4 P is SECONDS; Marlin reads P as milliseconds, so
  // a 3 s spin-up dwell would become 3 ms and the bit plunges before the
  // spindle is at speed.
  readonly cncJobs: boolean;
  // Momentary low-power M3/S positioning beam. This is a protocol capability;
  // the active machine profile and explicit operator opt-in must also allow it.
  readonly lowPowerFire: boolean;
  // GRBL 1.1 extended realtime override bytes (0x90–0x9D: feed/rapid/spindle).
  // false ⇒ the firmware has no realtime overrides, so such a byte would land
  // in its line buffer and corrupt the stream mid-job — the UI must not mount
  // the override controls and the send path must drop the byte (CTL-01).
  readonly overrides: boolean;
  // Whether the homing command runs while the controller is locked in Alarm.
  // GRBL-family `$H` is the documented way out of an alarm; a halted
  // Smoothieware board refuses every G-code line until M999, so its Home
  // sequence (M400 first) cannot run there (controller audit 2026-09-25
  // CG-4). Absent means true.
  readonly homeFromAlarm?: boolean;
  // Whether the firmware answers a status query while it homes. Stock GRBL
  // 1.1 services no realtime request inside its homing loop (limits.c:319-320,
  // "No time to run protocol_execute_realtime() in this loop"), so its Home
  // cannot be timed on status silence (controller audit 2026-09-25 ST-4).
  // Absent means true.
  readonly statusWhileHoming?: boolean;
  // A refused line's error stays latched and answers every later G-code line
  // until an empty line clears it: grblHAL at its default COMPATIBILITY_LEVEL
  // 0 (protocol.c:246-286). KerfDesk then sends one empty line after a refusal
  // (laser-parser-rearm.ts; controller audit 2026-09-25 HF-7). Absent means
  // false.
  readonly stickyLineError?: boolean;
  // Where the work offset comes from. 'reported' (GRBL-family, Smoothieware):
  // the status report carries it (WCO:, or MPos and WPos). 'host-recorded'
  // (Marlin): M114 reports only the work position, with the G92 shift applied
  // (motion.cpp:192-212), so KerfDesk keeps the shift it writes itself: a G92
  // sets it, homing and a restart clear it (motion.cpp:2346-2349), and Reset
  // origin restores machine coordinates with a computed G92, because a stock
  // build compiles no G92.1 (G92.cpp:62-70; controller audit 2026-09-25 MA-2,
  // CG-1, CG-11). Absent means 'reported'.
  readonly workOffsetSource?: 'reported' | 'host-recorded';
};
