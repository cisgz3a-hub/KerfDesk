// Moshiboard ControllerDriver (ADR-705). A Moshiboard (MS10105 class, older
// CO2 machines) speaks swizzled binary programs over a CH341 USB bridge in EPP
// mode — there is no serial G-code link for the line-based controller store,
// so for that store the transport is FILE-ONLY and every serial machine
// control is capability-gated off. No public Moshi file format exists (the
// board runs only what a host streams to it), so there is no file export
// either: the app reaches a Moshiboard through its own USB link and store,
// which offer only what MOSHI_USB_CAPABILITIES lists. Simulator-tested only,
// NOT qualified on hardware.
//
// This module stays type-only apart from plain data: selectControllerDriver
// is in the boot bundle, and the encoder and link load lazily.

import type { UsbLinkCapabilities } from '../controller-capabilities';
import type { ControllerDriver } from '../controller-driver';

/** What the Moshi USB link offers, each from MeerK40t's Moshi module
 *  (meerk40t/moshi at d511944e, MIT). Pause and Resume stay off: MeerK40t's
 *  `hold` only stops sending further programs (controller.py `pause`
 *  L425-441), and the board runs the program it holds to its end. */
export const MOSHI_USB_CAPABILITIES: UsbLinkCapabilities = {
  // Programs streamed one at a time over EPP (controller.py L597-695).
  start: 'stream-programs',
  // A laser-off vector program around the job's bounds (moshi-frame.ts).
  frame: 'travel-only-program',
  pause: false,
  resume: false,
  // The estop address write (builder.py `stop` L734-742).
  abort: true,
  // A move to the board's 0,0 at 40 mm/s (driver.py `home` L481-493).
  home: true,
  // Byte 1 of the CH341 status read: 205 OK, 207 busy, 237 error (L35-38).
  status: 'ch341-status',
  jog: false,
  console: false,
  settings: false,
  origin: false,
  overrides: false,
};

export const moshiDriver: ControllerDriver = {
  kind: 'moshi',
  label: 'Moshiboard (USB, experimental)',
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
  usbLink: MOSHI_USB_CAPABILITIES,
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
    reason: 'A Moshiboard has no serial console — connect it over USB in Machine details.',
  }),
  consoleQuickCommands: [],
  isSetupOnlyPayload: () => false,
};
