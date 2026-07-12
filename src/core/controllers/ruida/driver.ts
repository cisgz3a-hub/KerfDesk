// Ruida ControllerDriver (ADR-097). Ruida DSP controllers (RDC644x class)
// speak a proprietary swizzled binary protocol over USB/UDP — there is no
// serial G-code link for the app to drive. In this build the transport is
// FILE-ONLY: jobs are exported as .rd files (see core/controllers/ruida
// rd-encoder + io/rd), and every live machine control is capability-gated
// off. A pure UDP session state machine exists (ruida-udp-session.ts) as the
// groundwork for live streaming; wiring it to a real socket is future work.

import type { ControllerDriver } from '../controller-driver';

export const ruidaDriver: ControllerDriver = {
  kind: 'ruida',
  label: 'Ruida (.rd export)',
  defaultBaudRate: 115200, // unused — no serial transport
  capabilities: {
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
  realtime: {
    statusQuery: null,
    hold: null,
    resume: null,
    softReset: null,
    jogCancel: null,
  },
  commands: {
    home: null,
    unlock: null,
    sleep: null,
    settingsQuery: null,
    queuedStatusQuery: null,
    stopLaserLines: [],
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
