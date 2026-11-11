// The Ruida network store (ADR-697): one desktop UDP link to a Ruida
// controller, with Frame, Start, Pause, Resume and Abort — only what
// RUIDA_NETWORK_CAPABILITIES lists. It is separate from the line-based laser
// store, which cannot speak Ruida's binary protocol and still sees Ruida
// profiles as file-only. Frame-first holds here as everywhere (PROJECT.md
// non-negotiable 21, ADR-565): Start runs only the footprint a completed Frame
// on this connection traced; its advisories are warnings, never refusals.

import { create } from 'zustand';
import { RUIDA_SWIZZLE_MAGIC } from '../../../core/controllers/ruida';
import {
  encodeRdFrameJob,
  sameRdFootprint,
  type RdFootprint,
} from '../../../core/controllers/ruida/rd-frame-job';
import {
  decodeRuidaMachineStatus,
  ruidaStatusBusy,
  RUIDA_MEM_MACHINE_STATUS,
  RUIDA_PAUSE_PROCESS,
  RUIDA_RESTORE_PROCESS,
  RUIDA_STOP_PROCESS,
  type RuidaMachineStatus,
} from '../../../core/controllers/ruida/ruida-live-commands';
import type { RuidaDatagramLink, RuidaNetworkAdapter } from '../../../platform/ruida-network-types';
import { RuidaLinkExchange } from './ruida-link-exchange';
import {
  RUIDA_FRAME_FIRST,
  RUIDA_STATUS_SILENT,
  ruidaFailureText,
  ruidaNoReplyMessage,
  ruidaStatusText,
  ruidaStopOutcome,
} from './ruida-network-messages';
import { watchRuidaRun, type RuidaMonitor } from './ruida-network-monitor';
import { reportLinkMachineWork, type LinkMachineWork } from '../link-machine-work';

export type RuidaNetworkPhase =
  | 'disconnected'
  | 'connecting'
  | 'idle'
  | 'framing'
  | 'running'
  | 'paused'
  | 'stopping';

/** A compiled job: the exact .rd bytes Start streams, and where they run. */
export type RuidaNetworkJob = {
  readonly bytes: Uint8Array;
  readonly footprint: RdFootprint;
  readonly advisories: ReadonlyArray<string>;
  /** Runs once the controller reports the job finished (variable advance). */
  readonly completed?: () => void;
};

export type RuidaNetworkState = {
  readonly phase: RuidaNetworkPhase;
  readonly host: string | null;
  readonly message: string;
  readonly tone: 'info' | 'warning' | 'error';
  /** Datagrams acknowledged of the total while a job or frame is being sent. */
  readonly sending: { readonly acknowledged: number; readonly total: number } | null;
  readonly status: RuidaMachineStatus | null;
  readonly positionMm: { readonly x: number; readonly y: number } | null;
  /** The footprint the last completed Frame on this connection traced. */
  readonly framed: RdFootprint | null;
  readonly advisories: ReadonlyArray<string>;
  readonly connect: (adapter: RuidaNetworkAdapter, host: string, magic?: number) => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly frame: (job: RuidaNetworkJob) => Promise<void>;
  readonly start: (job: RuidaNetworkJob) => Promise<void>;
  readonly pause: () => Promise<void>;
  readonly resume: () => Promise<void>;
  readonly abort: () => Promise<void>;
};

type Live = {
  readonly link: RuidaDatagramLink;
  readonly exchange: RuidaLinkExchange;
  cancelSend: boolean;
  sendDone: Promise<unknown>;
  monitor: RuidaMonitor | null;
};

let live: Live | null = null;

const DISCONNECTED = {
  phase: 'disconnected',
  host: null,
  sending: null,
  status: null,
  positionMm: null,
  framed: null,
  advisories: [],
} as const;

type Set = (partial: Partial<RuidaNetworkState>) => void;
type Get = () => RuidaNetworkState;

export const useRuidaNetworkStore = create<RuidaNetworkState>()((set, get) => ({
  ...DISCONNECTED,
  message: '',
  tone: 'info',
  connect: (adapter, host, magic = RUIDA_SWIZZLE_MAGIC) => connect(set, get, adapter, host, magic),
  disconnect: () => disconnect(set, get),
  frame: (job) => run(set, get, 'frame', job),
  start: (job) => run(set, get, 'job', job),
  pause: () => processCommand(set, get, 'running', RUIDA_PAUSE_PROCESS, 'paused'),
  resume: () => processCommand(set, get, 'paused', RUIDA_RESTORE_PROCESS, 'running'),
  abort: () => abort(set, get),
}));

async function connect(
  set: Set,
  get: Get,
  adapter: RuidaNetworkAdapter,
  host: string,
  magic: number,
): Promise<void> {
  if (get().phase !== 'disconnected') return;
  set({ phase: 'connecting', host, message: `Opening UDP to ${host}…`, tone: 'info' });
  let link: RuidaDatagramLink;
  try {
    link = await adapter.open(host, magic);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    set({ ...DISCONNECTED, message, tone: 'error' });
    return;
  }
  const exchange = new RuidaLinkExchange(link, adapter.deadline, magic);
  const current: Live = {
    link,
    exchange,
    cancelSend: false,
    sendDone: Promise.resolve(),
    monitor: null,
  };
  live = current;
  link.onClose((reason) => linkClosed(set, get, current, reason));
  const reply = await exchange.read(RUIDA_MEM_MACHINE_STATUS);
  if (live !== current) return;
  if (reply === null) {
    live = null;
    await link.close();
    set({ ...DISCONNECTED, message: ruidaNoReplyMessage(host), tone: 'error' });
    return;
  }
  const status = decodeRuidaMachineStatus(reply.value);
  set({
    phase: 'idle',
    status,
    message: `Connected to the Ruida controller at ${host} (status: ${ruidaStatusText(status)}).`,
    tone: 'info',
  });
}

function linkClosed(set: Set, get: Get, closed: Live, reason: string | undefined): void {
  if (live !== closed) return;
  live = null;
  closed.monitor?.stop();
  const wasActive = ['framing', 'running', 'paused', 'stopping'].includes(get().phase);
  const why = reason === undefined ? '' : ` ${reason}`;
  const active = wasActive
    ? ' A job the controller holds keeps running without this link — check the machine and use its Stop key if needed.'
    : '';
  set({ ...DISCONNECTED, message: `The Ruida link closed.${why}${active}`, tone: 'error' });
}

async function disconnect(set: Set, get: Get): Promise<void> {
  const current = live;
  if (current === null) return;
  if (['framing', 'running', 'paused'].includes(get().phase)) await abort(set, get);
  if (live !== current) return;
  live = null;
  current.monitor?.stop();
  await current.link.close();
  set({ ...DISCONNECTED, message: 'Disconnected from the Ruida controller.', tone: 'info' });
}

async function run(set: Set, get: Get, kind: 'frame' | 'job', job: RuidaNetworkJob): Promise<void> {
  const current = live;
  if (current === null || get().phase !== 'idle') return;
  if (kind === 'job' && !sameRdFootprint(get().framed, job.footprint)) {
    set({ message: RUIDA_FRAME_FIRST, tone: 'warning' });
    return;
  }
  const status = await readyStatus(set, get, current);
  if (status === null) return;
  const frame = kind === 'frame';
  const bytes = frame ? encodeRdFrameJob(job.footprint, current.exchange.magic) : job.bytes;
  set({
    phase: frame ? 'framing' : 'running',
    status,
    // The job's warnings show from its Frame on (code quality audit C2 D1-P2-1).
    advisories: job.advisories,
    message: frame ? 'Sending the Frame (laser off)…' : 'Sending the job…',
    tone: 'info',
  });
  current.cancelSend = false;
  const sent = streamTo(set, current, bytes);
  current.sendDone = sent;
  if (await sent) watchToEnd(set, get, current, kind, job);
}

// A job the controller already runs (from its panel, or another program)
// would be interleaved with this one: factually, it cannot take another.
// The status when the controller is idle and this link still owns it.
async function readyStatus(set: Set, get: Get, current: Live): Promise<RuidaMachineStatus | null> {
  const reply = await current.exchange.read(RUIDA_MEM_MACHINE_STATUS);
  if (live !== current || get().phase !== 'idle') return null;
  const status = reply === null ? null : decodeRuidaMachineStatus(reply.value);
  if (status !== null && !ruidaStatusBusy(status)) return status;
  set({
    status,
    message:
      status === null
        ? 'The controller did not answer a status read; nothing was sent.'
        : `The controller reports it is busy (${ruidaStatusText(status)}); nothing was sent.`,
    tone: 'error',
  });
  return null;
}

/** True when every datagram was acknowledged; otherwise the run is over. */
async function streamTo(set: Set, current: Live, bytes: Uint8Array): Promise<boolean> {
  set({ sending: { acknowledged: 0, total: 0 } });
  const result = await current.exchange.stream(bytes, {
    onProgress: (acknowledged, total) => set({ sending: { acknowledged, total } }),
    cancelled: () => current.cancelSend,
  });
  set({ sending: null });
  if (result.ok) return true;
  // Abort sends its own stop; a closed link has none to send.
  if (result.failure === 'cancelled' || result.failure === 'link-closed' || live !== current)
    return false;
  // The controller may already run the part it received: stop it.
  const stop = await current.exchange.command(RUIDA_STOP_PROCESS);
  if (live !== current) return false;
  set({
    phase: 'idle',
    advisories: [],
    message: `Sending stopped after ${result.sentPackets} acknowledged datagram(s): ${ruidaFailureText(result.failure)} ${ruidaStopOutcome(stop.ok)}`,
    tone: 'error',
  });
  return false;
}

function watchToEnd(
  set: Set,
  get: Get,
  current: Live,
  kind: 'frame' | 'job',
  job: RuidaNetworkJob,
): void {
  // An Abort that arrived while the last datagram was acknowledged owns the
  // run now: no monitor may start after it and later report a finish.
  if (live !== current || current.cancelSend) return;
  set({
    message:
      kind === 'frame'
        ? 'Frame sent; waiting for the controller to finish tracing it.'
        : 'Job sent; the controller is running it.',
  });
  current.monitor = watchRuidaRun(current.exchange, {
    status: (status, positionMm) => set({ status, positionMm }),
    paused: () => get().phase === 'paused',
    silent: () => set({ message: RUIDA_STATUS_SILENT, tone: 'warning' }),
    finished: (sawBusy) => {
      current.monitor = null;
      // Only a run still in progress finishes; a stopped one never counts as a Frame.
      const phase = get().phase;
      if (live !== current || (phase !== 'framing' && phase !== 'running')) return;
      set(
        kind === 'frame'
          ? {
              phase: 'idle',
              framed: job.footprint,
              message: sawBusy
                ? 'Frame finished. Start is available for this footprint.'
                : 'Frame finished: the controller took the whole frame and read idle before any status read caught it moving (a short frame). Start is available for this footprint.',
              tone: 'info',
            }
          : {
              phase: 'idle',
              advisories: [],
              message: 'Job finished: the controller reports idle.',
              tone: 'info',
            },
      );
      // "After completed job" variable advance (code quality audit C2 D2-P2-3).
      if (kind === 'job') job.completed?.();
    },
  });
}

async function processCommand(
  set: Set,
  get: Get,
  from: 'running' | 'paused',
  command: ReadonlyArray<number>,
  to: 'running' | 'paused',
): Promise<void> {
  const current = live;
  if (current === null || get().phase !== from || get().sending !== null) return;
  const result = await current.exchange.command(command);
  if (live !== current || get().phase !== from) return;
  const verb = to === 'paused' ? 'Pause' : 'Resume';
  if (result.ok) {
    set({ phase: to, message: `${verb} acknowledged by the controller.`, tone: 'info' });
    return;
  }
  set({
    message: `${verb} was not acknowledged: ${ruidaFailureText(result.failure)} Use the controller panel.`,
    tone: 'error',
  });
}

async function abort(set: Set, get: Get): Promise<void> {
  const current = live;
  const phase = get().phase;
  if (current === null || (phase !== 'framing' && phase !== 'running' && phase !== 'paused'))
    return;
  current.cancelSend = true;
  current.monitor?.stop();
  current.monitor = null;
  set({ phase: 'stopping', message: 'Sending Stop Process…', tone: 'warning' });
  // The datagram in flight gets its verdict first: one exchange at a time.
  await current.sendDone;
  const stop = await current.exchange.command(RUIDA_STOP_PROCESS);
  if (live !== current) return;
  set({
    phase: 'idle',
    sending: null,
    advisories: [],
    message: ruidaStopOutcome(stop.ok),
    tone: stop.ok ? 'info' : 'error',
  });
}

/** Test support: forget the live link without closing it. */
export function resetRuidaNetworkStoreForTests(): void {
  live?.monitor?.stop();
  live = null;
  useRuidaNetworkStore.setState({ ...DISCONNECTED, message: '', tone: 'info' });
}

// Active work is reported where the always-mounted guards can see it without
// loading this store (link-machine-work.ts; ADR-705 Amendment 3).
const ACTIVE_WORK: Partial<Record<RuidaNetworkPhase, LinkMachineWork['activity']>> = {
  framing: 'framing',
  running: 'running',
  paused: 'paused',
  stopping: 'stopping',
};

useRuidaNetworkStore.subscribe((state) => {
  const activity = ACTIVE_WORK[state.phase];
  reportLinkMachineWork(
    'ruida-network',
    activity === undefined
      ? null
      : {
          controller: 'Ruida',
          activity,
          advisories: state.advisories,
          abort: () => useRuidaNetworkStore.getState().abort(),
        },
  );
});
