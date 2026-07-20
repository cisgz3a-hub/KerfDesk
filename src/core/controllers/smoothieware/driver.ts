// Smoothieware ControllerDriver (ADR-096 kickoff). GRBL-flavored realtime
// control (`?` status, `!` hold, `~` resume, Ctrl-X abort) with Marlin-style
// gaps: no $J jog, no $$ settings, no $X/$SLP. Halt recovery is M999. The
// laser power scale is fractional (S 0–1.0 by default) — handled by the
// smoothieware output strategy, not the driver.

import type { ControllerDriver } from '../controller-driver';
import { RT_HOLD, RT_RESUME, RT_SOFT_RESET, RT_STATUS } from '../grbl/commands';
import {
  buildSmoothieFrameLines,
  buildSmoothieJogCommand,
  SMOOTHIE_CMD_FIRMWARE_INFO,
  SMOOTHIE_CMD_HOME,
  SMOOTHIE_CMD_POSITION,
  SMOOTHIE_CMD_SETTLE,
  SMOOTHIE_CMD_UNLOCK,
  SMOOTHIE_CMD_VERSION,
  SMOOTHIE_STOP_LASER_LINES,
} from './commands';
import { prepareSmoothieConsoleCommand } from './console-command';
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
    realtimePause: true,
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
  },
  realtime: {
    statusQuery: RT_STATUS,
    hold: RT_HOLD,
    safetyDoor: null,
    resume: RT_RESUME,
    softReset: RT_SOFT_RESET,
    jogCancel: null,
  },
  commands: {
    home: SMOOTHIE_CMD_HOME,
    unlock: SMOOTHIE_CMD_UNLOCK,
    sleep: null,
    settingsQuery: null,
    buildInfoQuery: null,
    modalStateQuery: null,
    offsetsQuery: null,
    queuedStatusQuery: null,
    stopLaserLines: SMOOTHIE_STOP_LASER_LINES,
    frameToolOffLines: SMOOTHIE_STOP_LASER_LINES,
    settleDwell: SMOOTHIE_CMD_SETTLE,
    setOriginHere: 'G92 X0 Y0',
    clearOrigin: 'G92.1',
    setPersistentOriginHere: null,
    clearPersistentOrigin: null,
    buildJog: buildSmoothieJogCommand,
    buildFrameLines: buildSmoothieFrameLines,
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
};
