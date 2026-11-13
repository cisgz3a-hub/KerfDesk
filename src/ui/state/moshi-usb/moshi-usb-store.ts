// The Moshi USB store (ADR-705): one USB link to a Moshiboard, with Frame,
// Start, Home and Abort — only what MOSHI_USB_CAPABILITIES lists. It is
// separate from the line-based laser store, which cannot speak Moshi's binary
// programs and still sees Moshi profiles as file-only. Frame-first holds here
// as everywhere (PROJECT.md non-negotiable 21, ADR-565): Start runs only the
// footprint a completed Frame on this connection traced; its advisories are
// warnings, never refusals. A board that reports an error or no status is
// sent nothing: it factually cannot take the job.

import { create } from 'zustand';
import { sleep } from '../../common/sleep';
import {
  encodeMoshiFrameProgram,
  sameMoshiFootprint,
  type MoshiFootprint,
} from '../../../core/controllers/moshi/moshi-frame';
import {
  MOSHI_ESTOP_BYTE,
  moshiStatusCode,
} from '../../../core/controllers/moshi/moshi-live-commands';
import {
  moshiRunFailureText,
  runMoshiPrograms,
  type MoshiRunResult,
} from '../../../core/controllers/moshi/moshi-link-session';
import { writeHomeProgram } from '../../../core/controllers/moshi/moshi-programs';
import {
  MOSHI_ABORT_FAILED,
  MOSHI_ABORT_SENT,
  MOSHI_FRAME_FIRST,
  moshiDisconnectedMessage,
} from './moshi-usb-messages';
import type { MoshiUsbConnection, MoshiUsbJob, MoshiUsbOpener } from './moshi-usb-types';
import type { LinkMachineWork } from '../link-machine-work';
import { connectLinkStore } from '../link-store-connection';

export type MoshiUsbPhase =
  | 'disconnected'
  | 'connecting'
  | 'idle'
  | 'framing'
  | 'running'
  | 'homing'
  | 'stopping';

type RunKind = 'frame' | 'job' | 'home';

export type MoshiUsbState = {
  readonly phase: MoshiUsbPhase;
  readonly device: string | null;
  readonly message: string;
  readonly tone: 'info' | 'warning' | 'error';
  /** The last status code the board reported (205 OK, 207 busy, 237 error). */
  readonly status: number | null;
  readonly sending: { readonly sent: number; readonly total: number } | null;
  /** The footprint the last completed Frame on this connection traced. */
  readonly framed: MoshiFootprint | null;
  readonly advisories: ReadonlyArray<string>;
  readonly connect: (open: MoshiUsbOpener, options?: MoshiUsbConnectOptions) => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly frame: (job: MoshiUsbJob) => Promise<void>;
  readonly start: (job: MoshiUsbJob) => Promise<void>;
  readonly home: () => Promise<void>;
  readonly abort: () => Promise<void>;
};

export type MoshiUsbConnectOptions = {
  /** Test seam: how the run waits between status polls. */
  readonly wait?: (ms: number) => Promise<void>;
};

type Live = {
  readonly link: MoshiUsbConnection;
  readonly wait: (ms: number) => Promise<void>;
  cancelled: boolean;
  running: Promise<MoshiRunResult> | null;
  readonly unsubscribe: () => void;
};

let live: Live | null = null;

const DISCONNECTED = {
  phase: 'disconnected',
  device: null,
  status: null,
  sending: null,
  framed: null,
  advisories: [],
} as const;

type Set = (partial: Partial<MoshiUsbState>) => void;
type Get = () => MoshiUsbState;

export const useMoshiUsbStore = create<MoshiUsbState>()((set, get) => ({
  ...DISCONNECTED,
  message: '',
  tone: 'info',
  connect: (open, options) => connect(set, get, open, options?.wait ?? sleep),
  disconnect: () => disconnect(set, get),
  frame: (job) =>
    run(set, get, 'frame', [encodeMoshiFrameProgram(job.footprint, job.framingFeedMmPerMin)], job),
  start: (job) => {
    if (!sameMoshiFootprint(get().framed, job.footprint)) {
      set({ message: MOSHI_FRAME_FIRST, tone: 'warning' });
      return Promise.resolve();
    }
    return run(set, get, 'job', job.programs, job);
  },
  home: () => run(set, get, 'home', [writeHomeProgram()], null),
  abort: () => abort(set, get),
}));

async function connect(
  set: Set,
  get: Get,
  open: MoshiUsbOpener,
  wait: (ms: number) => Promise<void>,
): Promise<void> {
  if (get().phase !== 'disconnected') return;
  set({ phase: 'connecting', message: 'Opening the Moshiboard over USB…', tone: 'info' });
  let link: MoshiUsbConnection | null = null;
  let code: number | null;
  try {
    link = await open();
    code = moshiStatusCode(await link.readStatus());
  } catch (error) {
    // A device opened before the failure is released, so another program can
    // take it (code quality audit C2 D1-P3-1).
    await link?.close().catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    set({ ...DISCONNECTED, message, tone: 'error' });
    return;
  }
  if (code === null || code === 0) {
    await link.close().catch(() => undefined);
    set({
      ...DISCONNECTED,
      message: 'The board gave no status. Check the USB cable and that the machine is on.',
      tone: 'error',
    });
    return;
  }
  const current: Live = {
    link,
    wait,
    cancelled: false,
    running: null,
    unsubscribe: link.onDisconnect(() => linkLost(set, get, current)),
  };
  live = current;
  set({
    phase: 'idle',
    device: link.label,
    status: code,
    message: `Connected to the Moshiboard (${link.label}).`,
    tone: 'info',
  });
}

function linkLost(set: Set, get: Get, lost: Live): void {
  if (live !== lost) return;
  live = null;
  lost.cancelled = true;
  const active = ['framing', 'running', 'homing', 'stopping'].includes(get().phase);
  set({ ...DISCONNECTED, message: moshiDisconnectedMessage(active), tone: 'error' });
}

async function disconnect(set: Set, get: Get): Promise<void> {
  const current = live;
  if (current === null) return;
  if (['framing', 'running', 'homing'].includes(get().phase)) await abort(set, get);
  if (live !== current) return;
  live = null;
  current.unsubscribe();
  await current.link.close().catch(() => undefined);
  set({ ...DISCONNECTED, message: 'Disconnected from the Moshiboard.', tone: 'info' });
}

const RUN_PHASE = { frame: 'framing', job: 'running', home: 'homing' } as const;
const RUN_START = {
  frame: 'Sending the Frame (laser off)…',
  job: 'Sending the job…',
  home: 'Moving to the board’s 0,0…',
} as const;

async function run(
  set: Set,
  get: Get,
  kind: RunKind,
  programs: ReadonlyArray<Uint8Array>,
  job: MoshiUsbJob | null,
): Promise<void> {
  const current = live;
  if (current === null || get().phase !== 'idle') return;
  current.cancelled = false;
  set({
    phase: RUN_PHASE[kind],
    // The job's warnings show from its Frame on, not only once it is sent
    // (code quality audit C2 D1-P2-1); Home carries none.
    advisories: job === null ? [] : job.advisories,
    message: RUN_START[kind],
    tone: 'info',
    sending: { sent: 0, total: 0 },
  });
  const running = runMoshiPrograms(current.link, programs, {
    cancelled: () => current.cancelled,
    wait: current.wait,
    onStatus: (status) => {
      if (live === current) set({ status });
    },
    onProgress: (sent, total) => {
      if (live === current) set({ sending: { sent, total } });
    },
  });
  current.running = running;
  const result = await running;
  current.running = null;
  // Abort and a lost link report for themselves.
  if (live !== current || current.cancelled) return;
  if (result.ok) {
    set({ phase: 'idle', sending: null, ...finishedState(kind, job), tone: 'info' });
    // "After completed job" variable advance (code quality audit C2 D2-P2-3).
    if (kind === 'job') job?.completed();
    return;
  }
  set({
    phase: 'idle',
    sending: null,
    advisories: [],
    message: `Stopped: ${moshiRunFailureText(result.failure)}`,
    tone: 'error',
  });
}

function finishedState(kind: RunKind, job: MoshiUsbJob | null): Partial<MoshiUsbState> {
  switch (kind) {
    case 'frame':
      return {
        framed: job?.footprint ?? null,
        message: 'Frame finished. Start is available for this footprint.',
      };
    case 'job':
      return { advisories: [], message: 'Job finished: the board reports ready.' };
    case 'home':
      return { message: 'The head is at the board’s 0,0.' };
  }
}

async function abort(set: Set, get: Get): Promise<void> {
  const current = live;
  const phase = get().phase;
  if (current === null || (phase !== 'framing' && phase !== 'running' && phase !== 'homing'))
    return;
  current.cancelled = true;
  set({ phase: 'stopping', message: 'Sending estop…', tone: 'warning' });
  // MeerK40t sends the estop at once and drops every queued program
  // (controller.py `realtime` L381-402); the run stops at its next step.
  let sent = true;
  try {
    await current.link.writeAddress(Uint8Array.of(MOSHI_ESTOP_BYTE));
  } catch {
    sent = false;
  }
  await current.running;
  if (live !== current) return;
  set({
    phase: 'idle',
    sending: null,
    advisories: [],
    // The head stopped somewhere along its path: the Frame no longer stands.
    framed: null,
    message: sent ? MOSHI_ABORT_SENT : MOSHI_ABORT_FAILED,
    tone: sent ? 'info' : 'error',
  });
}

/** Test support: forget the live link without closing it. */
export function resetMoshiUsbStoreForTests(): void {
  live?.unsubscribe();
  live = null;
  useMoshiUsbStore.setState({ ...DISCONNECTED, message: '', tone: 'info' });
}

// Active work is reported where the always-mounted guards can see it without
// loading this store (link-machine-work.ts; ADR-705 Amendment 3).
const ACTIVE_WORK: Partial<Record<MoshiUsbPhase, LinkMachineWork['activity']>> = {
  framing: 'framing',
  running: 'running',
  homing: 'homing',
  stopping: 'stopping',
};

connectLinkStore('moshi-usb', useMoshiUsbStore, {
  controller: 'Moshiboard',
  activeWork: ACTIVE_WORK,
});
