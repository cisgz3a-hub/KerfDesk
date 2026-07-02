// Marlin ControllerDriver (ADR-095 kickoff). The deepest divergence from the
// GRBL family: NO realtime bytes exist, so pause is stream-side (buffered
// motion drains), stop is stop-sending + beam-off lines, status is a queued
// M114 polled only while nothing is streaming, and settings are read-only
// text (exposed via console M503, not the settings panel).

import type { ControllerDriver } from '../controller-driver';
import {
  buildMarlinFrameLines,
  buildMarlinJogCommand,
  MARLIN_CMD_EMERGENCY_STOP,
  MARLIN_CMD_FIRMWARE_INFO,
  MARLIN_CMD_HOME_XY,
  MARLIN_CMD_POSITION,
  MARLIN_CMD_SETTLE,
  MARLIN_CMD_SETTINGS_DUMP,
  MARLIN_CMD_TEMPERATURES,
  MARLIN_STOP_LASER_LINES,
} from './commands';
import { prepareMarlinConsoleCommand } from './console-command';
import { classifyMarlinResponse } from './response';

export const MARLIN_DEFAULT_BAUD_RATE = 250000;

export const marlinDriver: ControllerDriver = {
  kind: 'marlin',
  label: 'Marlin',
  defaultBaudRate: MARLIN_DEFAULT_BAUD_RATE,
  capabilities: {
    transport: 'serial',
    jog: 'gcode-relative',
    jogCancel: false,
    realtimePause: false,
    softStop: false,
    statusQuery: 'queued-poll',
    settings: 'none',
    unlock: false,
    sleep: false,
    wcs: 'none',
    homing: true,
    console: true,
    firmwareSetupPanel: 'none',
  },
  realtime: {
    statusQuery: null,
    hold: null,
    resume: null,
    softReset: null,
    jogCancel: null,
  },
  commands: {
    home: MARLIN_CMD_HOME_XY,
    unlock: null,
    sleep: null,
    settingsQuery: null,
    queuedStatusQuery: MARLIN_CMD_POSITION,
    stopLaserLines: MARLIN_STOP_LASER_LINES,
    settleDwell: MARLIN_CMD_SETTLE,
    setOriginHere: null,
    clearOrigin: null,
    setPersistentOriginHere: null,
    clearPersistentOrigin: null,
    buildJog: buildMarlinJogCommand,
    buildFrameLines: buildMarlinFrameLines,
  },
  classifyLine: classifyMarlinResponse,
  prepareConsoleCommand: prepareMarlinConsoleCommand,
  consoleQuickCommands: [
    { label: MARLIN_CMD_FIRMWARE_INFO, command: MARLIN_CMD_FIRMWARE_INFO, hint: 'Firmware info' },
    { label: MARLIN_CMD_POSITION, command: MARLIN_CMD_POSITION, hint: 'Position report' },
    { label: MARLIN_CMD_TEMPERATURES, command: MARLIN_CMD_TEMPERATURES, hint: 'Temperatures' },
    {
      label: MARLIN_CMD_SETTINGS_DUMP,
      command: MARLIN_CMD_SETTINGS_DUMP,
      hint: 'Settings dump (read-only)',
    },
    { label: MARLIN_CMD_SETTLE, command: MARLIN_CMD_SETTLE, hint: 'Wait for moves to finish' },
    {
      label: MARLIN_CMD_EMERGENCY_STOP,
      command: MARLIN_CMD_EMERGENCY_STOP,
      hint: 'EMERGENCY STOP (halts firmware; reconnect required)',
    },
  ],
  // M500/M502 persist firmware state; block them inside streamed payloads the
  // same way GRBL blocks $-lines mid-job.
  isSetupOnlyPayload: (payload) => /(^|\n)\s*M50[02]\b/i.test(payload),
};
