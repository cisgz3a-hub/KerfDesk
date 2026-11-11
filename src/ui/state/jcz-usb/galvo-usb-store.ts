// The galvo USB store (ADR-704): one USB link to a JCZ LMC board, with a
// red-light Frame, Start, Pause, Resume and Abort — only what
// JCZ_GALVO_USB_CAPABILITIES lists. It is separate from the line-based laser
// store, which sees a galvo as file-only, as the Ruida network store is.
// Frame-first holds here as everywhere (PROJECT.md non-negotiable 21,
// ADR-565): Start runs only the footprint a completed Frame on this connection
// traced; its advisories are warnings, never refusals.

import { create } from 'zustand';
import type { LmcCorrectionTable } from '../../../core/controllers/jcz/lmc-cor-file';
import type { LmcProgram } from '../../../core/controllers/jcz/lmc-encoder';
import { sameLmcFootprint, type LmcFootprint } from '../../../core/controllers/jcz/lmc-footprint';
import type { LmcFrameProgram } from '../../../core/controllers/jcz/lmc-frame-job';
import { LmcLink, type LmcListState } from '../../../core/controllers/jcz/lmc-link';
import { LMC_USB_PRODUCT_ID, LMC_USB_VENDOR_ID } from '../../../core/controllers/jcz/lmc-opcodes';
import {
  abortLmcProgram,
  initializeLmcBoard,
  pauseLmcProgram,
  resumeLmcProgram,
} from '../../../core/controllers/jcz/lmc-run';
import { GALVO_FRAME_FIRST, galvoStopOutcome } from './galvo-usb-messages';
import { runGalvoProgram, type GalvoLive } from './galvo-usb-run';
import type { GalvoUsbAdapter, GalvoUsbSession } from './galvo-usb-types';

export type GalvoUsbPhase =
  | 'disconnected'
  | 'connecting'
  | 'idle'
  | 'framing'
  | 'running'
  | 'paused'
  | 'stopping';

/** A compiled job: the program Start sends and the red-light Frame of it. */
export type GalvoUsbJob = {
  readonly program: LmcProgram;
  readonly frame: LmcFrameProgram;
  readonly advisories: ReadonlyArray<string>;
};

export type GalvoUsbState = {
  readonly phase: GalvoUsbPhase;
  readonly message: string;
  readonly tone: 'info' | 'warning' | 'error';
  readonly board: { readonly serial: string; readonly version: string } | null;
  readonly listState: LmcListState | null;
  readonly sending: { readonly sent: number; readonly total: number } | null;
  /** The footprint the last completed Frame on this connection traced. */
  readonly framed: LmcFootprint | null;
  readonly advisories: ReadonlyArray<string>;
  readonly connect: (
    adapter: GalvoUsbAdapter,
    correction: LmcCorrectionTable | null,
  ) => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly frame: (job: GalvoUsbJob) => Promise<void>;
  readonly start: (job: GalvoUsbJob) => Promise<void>;
  readonly pause: () => Promise<void>;
  readonly resume: () => Promise<void>;
  readonly abort: () => Promise<void>;
};

export const LMC_DEVICE_FILTERS = [{ vendorId: LMC_USB_VENDOR_ID, productId: LMC_USB_PRODUCT_ID }];

let live: GalvoLive | null = null;

const DISCONNECTED = {
  phase: 'disconnected',
  board: null,
  listState: null,
  sending: null,
  framed: null,
  advisories: [],
} as const;

export type GalvoSet = (partial: Partial<GalvoUsbState>) => void;
export type GalvoGet = () => GalvoUsbState;

export const useGalvoUsbStore = create<GalvoUsbState>()((set, get) => ({
  ...DISCONNECTED,
  message: '',
  tone: 'info',
  connect: (adapter, correction) => connect(set, get, adapter, correction),
  disconnect: () => disconnect(set, get),
  frame: (job) => run(set, get, 'frame', job),
  start: (job) => run(set, get, 'job', job),
  pause: () => holdOrResume(set, get, 'pause'),
  resume: () => holdOrResume(set, get, 'resume'),
  abort: () => abort(set, get),
}));

async function connect(
  set: GalvoSet,
  get: GalvoGet,
  adapter: GalvoUsbAdapter,
  correction: LmcCorrectionTable | null,
): Promise<void> {
  if (get().phase !== 'disconnected') return;
  set({ phase: 'connecting', message: 'Choose the JCZ galvo board…', tone: 'info' });
  let session: GalvoUsbSession | null;
  try {
    session = await adapter.request(LMC_DEVICE_FILTERS);
  } catch (error) {
    set({ ...DISCONNECTED, message: errorText(error), tone: 'error' });
    return;
  }
  if (session === null) {
    set({ ...DISCONNECTED, message: 'No board was chosen.', tone: 'info' });
    return;
  }
  const current: GalvoLive = {
    session,
    link: new LmcLink(session),
    cancel: false,
    done: Promise.resolve(),
    executing: false,
    fiber: false,
  };
  live = current;
  session.onDisconnect(() => linkLost(set, get, current));
  set({ message: 'Initialising the board…' });
  const init = await initializeLmcBoard(current.link, correction);
  if (live !== current) return;
  if (!init.ok) {
    live = null;
    await session.close().catch(() => undefined);
    set({ ...DISCONNECTED, message: init.reason, tone: 'error' });
    return;
  }
  set({
    phase: 'idle',
    board: { serial: init.serial, version: init.version },
    message: `Connected to the JCZ board${correction === null ? '' : ' with its lens correction'}.`,
    tone: 'info',
  });
}

function linkLost(set: GalvoSet, get: GalvoGet, lost: GalvoLive): void {
  if (live !== lost) return;
  live = null;
  lost.cancel = true;
  const active = ['framing', 'running', 'paused', 'stopping'].includes(get().phase)
    ? ' A program the board holds may keep running — check the machine and use its emergency stop if needed.'
    : '';
  set({ ...DISCONNECTED, message: `The galvo board was disconnected.${active}`, tone: 'error' });
}

async function disconnect(set: GalvoSet, get: GalvoGet): Promise<void> {
  const current = live;
  if (current === null) return;
  if (['framing', 'running', 'paused'].includes(get().phase)) await abort(set, get);
  if (live !== current) return;
  live = null;
  await current.session.close().catch(() => undefined);
  set({ ...DISCONNECTED, message: 'Disconnected from the galvo board.', tone: 'info' });
}

async function run(
  set: GalvoSet,
  get: GalvoGet,
  kind: 'frame' | 'job',
  job: GalvoUsbJob,
): Promise<void> {
  const current = live;
  if (current === null || get().phase !== 'idle') return;
  if (kind === 'job' && !sameLmcFootprint(get().framed, job.program.footprint)) {
    set({ message: GALVO_FRAME_FIRST, tone: 'warning' });
    return;
  }
  const status = await current.link.boardStatus();
  if (live !== current || get().phase !== 'idle') return;
  if (status === null || status.busy) {
    set({
      message:
        status === null
          ? 'The board did not answer a status read; nothing was sent.'
          : 'The board reports it is busy; nothing was sent.',
      tone: 'error',
    });
    return;
  }
  const done = runGalvoProgram({ set, get, current, isLive: () => live === current }, kind, job);
  current.done = done;
  await done;
}

async function holdOrResume(set: GalvoSet, get: GalvoGet, verb: 'pause' | 'resume'): Promise<void> {
  const current = live;
  const from = verb === 'pause' ? 'running' : 'paused';
  if (current === null || get().phase !== from) return;
  // Paused before Execute List: the lists are held, nothing runs yet.
  const ok = current.executing
    ? await (verb === 'pause' ? pauseLmcProgram(current.link) : resumeLmcProgram(current.link))
    : true;
  if (live !== current || get().phase !== from) return;
  const label = verb === 'pause' ? 'Pause (Stop List)' : 'Resume (Restart List)';
  set(
    ok
      ? {
          phase: verb === 'pause' ? 'paused' : 'running',
          message: `${label} acknowledged by the board.`,
          tone: 'info',
        }
      : {
          message: `${label} was not acknowledged: ${current.link.lastFailure ?? ''}`,
          tone: 'error',
        },
  );
}

async function abort(set: GalvoSet, get: GalvoGet): Promise<void> {
  const current = live;
  const phase = get().phase;
  if (current === null || (phase !== 'framing' && phase !== 'running' && phase !== 'paused'))
    return;
  current.cancel = true;
  set({ phase: 'stopping', message: 'Sending Stop Execute…', tone: 'warning' });
  const stopped = await abortLmcProgram(current.link, current.executing);
  await current.done;
  if (live !== current) return;
  current.executing = false;
  set({
    phase: 'idle',
    sending: null,
    advisories: [],
    message: galvoStopOutcome(stopped),
    tone: stopped ? 'info' : 'error',
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Test support: forget the live link without closing it. */
export function resetGalvoUsbStoreForTests(): void {
  if (live !== null) live.cancel = true;
  live = null;
  useGalvoUsbStore.setState({ ...DISCONNECTED, message: '', tone: 'info' });
}
