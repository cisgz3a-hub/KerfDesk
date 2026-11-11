// Ruida ControllerDriver (ADR-097, ADR-697). Ruida DSP controllers (RDC644x
// class) speak a proprietary swizzled binary protocol over USB/UDP — there is
// no serial G-code link for the app's line-based controller store to drive, so
// for that store the transport stays FILE-ONLY: jobs are exported as .rd files
// (core/controllers/ruida rd-encoder + io/rd) and every serial machine control
// is capability-gated off. The desktop app also reaches a Ruida over the
// network (ADR-697) through its own link and store, which offer only what
// RUIDA_NETWORK_CAPABILITIES lists; that path is simulator-tested only and
// NOT qualified on a real controller.

import type { DatagramNetworkCapabilities } from '../controller-capabilities';
import type { ControllerDriver } from '../controller-driver';

/** What the desktop Ruida network link offers (ADR-697), each backed by a
 *  public protocol source (ruida-live-commands.ts, rd-frame-job.ts). Jog,
 *  home, console, settings, origin and overrides stay off: no public source
 *  this repo has checked documents those commands well enough to send them. */
export const RUIDA_NETWORK_CAPABILITIES: DatagramNetworkCapabilities = {
  // Stream the encoded .rd job over UDP datagrams (ruida-udp-session.ts).
  start: 'stream-rd',
  // A travel-only .rd job around the job's bounds (rd-frame-job.ts).
  frame: 'travel-only-rd',
  // D8 02 Pause Process / D8 03 Restore Process / D8 01 Stop Process.
  pause: true,
  resume: true,
  abort: true,
  // DA 00 reads of the machine-status bits and current X/Y.
  status: 'memory-read',
  jog: false,
  home: false,
  console: false,
  settings: false,
  origin: false,
  overrides: false,
};

export const ruidaDriver: ControllerDriver = {
  kind: 'ruida',
  label: 'Ruida (.rd export)',
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
  datagramNetwork: RUIDA_NETWORK_CAPABILITIES,
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
    reason: 'Ruida controllers have no serial console in this build — export .rd files instead.',
  }),
  consoleQuickCommands: [],
  isSetupOnlyPayload: () => false,
};
