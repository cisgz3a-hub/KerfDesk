// Lihuiyu ControllerDriver (ADR-703). Lihuiyu M2/M3 Nano boards (the stock
// K40 controller) speak LHYMicro-GL, a binary packet protocol behind a CH341
// USB bridge — there is no serial G-code link for the app's line-based
// controller store to drive, so for that store the transport stays FILE-ONLY:
// jobs save as .egv files (lhy-encoder + io/egv) and every serial machine
// control is capability-gated off. The app also drives the board over USB
// (ADR-703) through its own link and store, which offer only what
// LIHUIYU_USB_CAPABILITIES lists; that path is simulator-tested only and NOT
// qualified on a real board.
//
// This file stays free of the encoder: selectControllerDriver loads it at
// boot, and the encoder and link load only when a Lihuiyu job is saved or run.

import type { UsbLinkCapabilities } from '../controller-capabilities';
import type { ControllerDriver } from '../controller-driver';

/** What the Lihuiyu USB link offers (ADR-703), each a command MeerK40t's MIT
 *  driver documents (meerk40t/lihuiyu/driver.py at d511944e). Console,
 *  settings, origin and overrides stay off: the board has none. */
export const LIHUIYU_USB_CAPABILITIES: UsbLinkCapabilities = {
  // The encoded job's 30-byte packets, each acknowledged by the status byte.
  start: 'stream-packets',
  // The job's bounds traced in program mode with the beam never on (lhy-frame.ts).
  frame: 'travel-only',
  // "PN" pauses and resumes the board (driver.py pause/resume, L318-340);
  // "I" resets it (reset, L342-361).
  pause: true,
  resume: true,
  abort: true,
  // "IPP" homes the head (home, L674-696).
  home: true,
  // Rapid-mode relative moves (move_rel, L391-412).
  jog: 'relative',
  // The CH341 status read; byte 1 is the board's status code (controller.py).
  status: 'status-byte',
  console: false,
  settings: false,
  origin: false,
  overrides: false,
};

export const lihuiyuDriver: ControllerDriver = {
  kind: 'lihuiyu',
  label: 'Lihuiyu M2/M3 Nano (K40)',
  defaultBaudRate: 115200, // unused — no serial transport
  capabilities: {
    startProtocol: 'file-only',
    transport: 'file-only',
    jog: 'none',
    jogCancel: false,
    realtimePause: false,
    softStop: false,
    statusQuery: 'none',
    settings: 'none',
    unlock: false,
    sleep: false,
    wcs: 'none',
    homing: false,
    console: false,
    firmwareSetupPanel: 'none',
    probing: false,
    cncJobs: false,
    lowPowerFire: false,
    overrides: false,
  },
  usbLink: LIHUIYU_USB_CAPABILITIES,
  fileFormat: 'egv',
  realtime: {
    statusQuery: null,
    hold: null,
    safetyDoor: null,
    resume: null,
    softReset: null,
    jogCancel: null,
  },
  commands: {
    home: null,
    unlock: null,
    sleep: null,
    settingsQuery: null,
    buildInfoQuery: null,
    modalStateQuery: null,
    offsetsQuery: null,
    queuedStatusQuery: null,
    stopLaserLines: [],
    frameToolOffLines: [],
    settleDwell: '',
    setOriginHere: null,
    clearOrigin: null,
    setPersistentOriginHere: null,
    clearPersistentOrigin: null,
    buildJog: () => '',
    buildFrameLines: () => [],
  },
  classifyLine: (line) => ({ kind: 'unknown', raw: line }),
  prepareConsoleCommand: () => ({
    ok: false,
    reason: 'Lihuiyu boards have no console — save an .egv file or use the USB link.',
  }),
  consoleQuickCommands: [],
  isSetupOnlyPayload: () => false,
};
