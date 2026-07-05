// The GRBL v1.1 ControllerDriver — a thin assembly of the existing grbl
// modules behind the firmware-neutral driver interface (ADR-094). Every
// string here must stay byte-identical to the pre-driver constants; the
// lifecycle simulator tests assert the wire bytes.

import type { ControllerDriver } from '../controller-driver';
import {
  buildJogCommand,
  CMD_BUILD_INFO,
  CMD_CLEAR_ORIGIN,
  CMD_CLEAR_PERSISTENT_ORIGIN,
  CMD_COOLANT_OFF,
  CMD_HOME,
  CMD_SET_ORIGIN_HERE,
  CMD_SET_PERSISTENT_ORIGIN_HERE,
  CMD_SETTINGS,
  CMD_SLEEP,
  CMD_UNLOCK,
  RT_HOLD,
  RT_JOG_CANCEL,
  RT_RESUME,
  RT_SOFT_RESET,
  RT_STATUS,
} from './commands';
import { CMD_MODAL_STATE, CMD_OFFSETS, prepareConsoleCommand } from './console-command';
import { buildGrblFrameJogLines } from './frame-lines';
import { classifyResponse } from './response';

/** GRBL's ack-fenced settle marker: a 10 ms dwell whose `ok` proves the
 *  planner reached it (used after homing and at job end). */
export const GRBL_SETTLE_DWELL = 'G4 P0.01';

export const GRBL_DEFAULT_BAUD_RATE = 115200;

export const grblDriver: ControllerDriver = {
  kind: 'grbl-v1.1',
  label: 'GRBL v1.1',
  defaultBaudRate: GRBL_DEFAULT_BAUD_RATE,
  capabilities: {
    transport: 'serial',
    jog: 'native-jog',
    jogCancel: true,
    realtimePause: true,
    softStop: true,
    statusQuery: 'realtime-report',
    settings: 'grbl-dollar',
    unlock: true,
    sleep: true,
    wcs: 'g92-and-g10',
    homing: true,
    console: true,
    firmwareSetupPanel: 'grbl-laser',
    probing: true,
    cncJobs: true,
  },
  realtime: {
    statusQuery: RT_STATUS,
    hold: RT_HOLD,
    resume: RT_RESUME,
    softReset: RT_SOFT_RESET,
    jogCancel: RT_JOG_CANCEL,
  },
  commands: {
    home: CMD_HOME,
    unlock: CMD_UNLOCK,
    sleep: CMD_SLEEP,
    settingsQuery: CMD_SETTINGS,
    queuedStatusQuery: null,
    stopLaserLines: [CMD_COOLANT_OFF],
    settleDwell: GRBL_SETTLE_DWELL,
    setOriginHere: CMD_SET_ORIGIN_HERE,
    clearOrigin: CMD_CLEAR_ORIGIN,
    setPersistentOriginHere: CMD_SET_PERSISTENT_ORIGIN_HERE,
    clearPersistentOrigin: CMD_CLEAR_PERSISTENT_ORIGIN,
    buildJog: buildJogCommand,
    buildFrameLines: buildGrblFrameJogLines,
  },
  classifyLine: classifyResponse,
  prepareConsoleCommand,
  // Order matches the pre-ADR-094 ConsolePanel quick row exactly.
  consoleQuickCommands: [
    { label: CMD_UNLOCK, command: CMD_UNLOCK, hint: 'Unlock (clear alarm)' },
    { label: CMD_SETTINGS, command: CMD_SETTINGS, hint: 'Settings dump' },
    { label: CMD_OFFSETS, command: CMD_OFFSETS, hint: 'Work offsets' },
    { label: CMD_BUILD_INFO, command: CMD_BUILD_INFO, hint: 'Build info' },
    { label: CMD_MODAL_STATE, command: CMD_MODAL_STATE, hint: 'Modal state' },
    { label: RT_STATUS, command: RT_STATUS, hint: 'Status report' },
  ],
  isSetupOnlyPayload: (payload) =>
    payload.split(/\r?\n/).some((line) => line.trim().startsWith('$')),
};
