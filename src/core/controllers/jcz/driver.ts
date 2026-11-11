// JCZ LMC (EZCad2-class) galvo ControllerDriver (ADR-704). A galvo board
// takes binary list packets over USB, not G-code lines, so for the line-based
// controller store the transport stays FILE-ONLY and every serial control is
// off, as for Ruida. A galvo has no job file either: Save refuses it, and the
// work runs over the separate USB link and store (ui/state/jcz-usb), which
// offer only what JCZ_GALVO_USB_CAPABILITIES lists. Simulator-tested only;
// NOT qualified on a real board.

import type { GalvoUsbCapabilities } from '../controller-capabilities';
import type { ControllerDriver } from '../controller-driver';

/** What the galvo USB link offers, each backed by MeerK40t's balormk
 *  (lmc-run.ts, lmc-frame-job.ts). Jog, home, console, settings, origin and
 *  overrides stay off: a galvo has none in this build. */
export const JCZ_GALVO_USB_CAPABILITIES: GalvoUsbCapabilities = {
  start: 'lmc-list',
  frame: 'red-light',
  pause: true,
  resume: true,
  abort: true,
  status: 'list-status',
  correctionFile: true,
  jog: false,
  home: false,
  console: false,
  settings: false,
  origin: false,
  overrides: false,
};

export const jczLmcDriver: ControllerDriver = {
  kind: 'jcz-lmc',
  label: 'JCZ LMC galvo (USB, experimental)',
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
  galvoUsb: JCZ_GALVO_USB_CAPABILITIES,
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
    reason: 'A JCZ galvo has no console in this build — use the Galvo USB panel.',
  }),
  consoleQuickCommands: [],
  isSetupOnlyPayload: () => false,
};
