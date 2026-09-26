// Smoothieware ControllerDriver (ADR-096 kickoff). GRBL-flavored realtime
// status (`?`) and Ctrl-X abort with Marlin-style gaps: no $J jog, no $$
// settings, no $X/$SLP. Halt recovery is M999. The laser power scale is
// fractional (S 0–1.0 by default) — handled by the smoothieware output
// strategy, not the driver.

import type { ControllerDriver } from '../controller-driver';
import { RT_SOFT_RESET, RT_STATUS } from '../grbl/commands';
import {
  buildSmoothieFrameLines,
  buildSmoothieJogCommand,
  SMOOTHIE_CMD_FIRMWARE_INFO,
  SMOOTHIE_CMD_HOME,
  SMOOTHIE_CMD_POP_STATE,
  SMOOTHIE_CMD_POSITION,
  SMOOTHIE_CMD_PUSH_STATE,
  SMOOTHIE_CMD_SETTLE,
  SMOOTHIE_CMD_UNLOCK,
  SMOOTHIE_CMD_VERSION,
  SMOOTHIE_STOP_LASER_LINES,
  SMOOTHIE_FRAME_TOOL_OFF_LINES,
} from './commands';
import { prepareSmoothieConsoleCommand } from './console-command';
import { smoothieHomeVerification } from './home-verification';
import { smoothieLaserModuleProbe } from './laser-module';
import { classifySmoothieResponse } from './response';

export const SMOOTHIE_DEFAULT_BAUD_RATE = 115200;

export const smoothiewareDriver: ControllerDriver = {
  kind: 'smoothieware',
  label: 'Smoothieware',
  defaultBaudRate: SMOOTHIE_DEFAULT_BAUD_RATE,
  capabilities: {
    startProtocol: 'smoothie-live',
    transport: 'serial',
    jog: 'gcode-relative',
    jogCancel: false,
    realtimePause: false,
    softStop: true,
    statusQuery: 'realtime-report',
    settings: 'none',
    unlock: true,
    sleep: false,
    wcs: 'g92-only',
    homing: true,
    console: true,
    firmwareSetupPanel: 'none',
    probing: false,
    cncJobs: false,
    lowPowerFire: false,
    overrides: false,
    // A halted board answers its Home sequence's first line (M400) with `!!`
    // until M999 (GcodeDispatch.cpp:158-180).
    homeFromAlarm: false,
    // Ctrl-X halts the board; it does not reboot or print a banner (CG-3).
    softResetReboots: false,
  },
  realtime: {
    statusQuery: RT_STATUS,
    // Smoothieware handles !/~ only on its USB CDC transport and only when
    // enable_feed_hold is configured. KerfDesk has no session-bound evidence
    // for either prerequisite, so the generic driver must not claim these bytes
    // as controller realtime commands.
    hold: null,
    safetyDoor: null,
    resume: null,
    softReset: RT_SOFT_RESET,
    jogCancel: null,
  },
  commands: {
    // M400 first also gives a terminal rejection while halted; the shell's
    // fire-off command itself is silently ignored in that state. That
    // rejection also keeps `$H`, which clears a halt before homing, from ever
    // unlocking a halted board behind the operator's back.
    home: ['M400', ...SMOOTHIE_FRAME_TOOL_OFF_LINES, SMOOTHIE_CMD_HOME].join('\n'),
    unlock: SMOOTHIE_CMD_UNLOCK,
    sleep: null,
    settingsQuery: null,
    buildInfoQuery: null,
    // `$G` prints `[GC:...]` then `ok` (SimpleShell.cpp:218-222, 879-882), so
    // the Frame can read the active WCS before it selects G54 (audit CG-2).
    modalStateQuery: '$G',
    offsetsQuery: null,
    queuedStatusQuery: null,
    stopLaserLines: SMOOTHIE_STOP_LASER_LINES,
    frameToolOffLines: SMOOTHIE_FRAME_TOOL_OFF_LINES,
    settleDwell: SMOOTHIE_CMD_SETTLE,
    setOriginHere: 'G92 X0 Y0',
    clearOrigin: 'G92.1',
    setPersistentOriginHere: null,
    clearPersistentOrigin: null,
    buildJog: buildSmoothieJogCommand,
    buildFrameLines: buildSmoothieFrameLines,
    frameModalState: { push: SMOOTHIE_CMD_PUSH_STATE, pop: SMOOTHIE_CMD_POP_STATE },
  },
  classifyLine: classifySmoothieResponse,
  prepareConsoleCommand: prepareSmoothieConsoleCommand,
  consoleQuickCommands: [
    { label: SMOOTHIE_CMD_UNLOCK, command: SMOOTHIE_CMD_UNLOCK, hint: 'Clear halt (kill/limit)' },
    { label: SMOOTHIE_CMD_POSITION, command: SMOOTHIE_CMD_POSITION, hint: 'Position report' },
    {
      label: SMOOTHIE_CMD_FIRMWARE_INFO,
      command: SMOOTHIE_CMD_FIRMWARE_INFO,
      hint: 'Firmware info',
    },
    { label: SMOOTHIE_CMD_VERSION, command: SMOOTHIE_CMD_VERSION, hint: 'Smoothie version' },
    { label: RT_STATUS, command: RT_STATUS, hint: 'Status report' },
  ],
  // config-set/config-load persist Smoothie configuration; block them inside
  // streamed payloads the same way GRBL blocks $-lines mid-job.
  isSetupOnlyPayload: (payload) => /(^|\n)\s*config-(set|load)\b/i.test(payload),
  // `fire off` and the M221 power modes exist only while the Laser module is
  // loaded; qualification asks the board with M221 (laser-module.ts).
  laserModuleProbe: smoothieLaserModuleProbe,
  // `$H` answers `ok` whether or not anything homed (audit SM-6).
  homeVerification: smoothieHomeVerification,
};
