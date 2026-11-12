// The Lihuiyu USB store (ADR-703): one link to a K40's M2/M3 Nano board over
// its CH341 bridge, offering Home, Jog, Frame, Start, Pause, Resume and Abort
// — only what LIHUIYU_USB_CAPABILITIES lists. It is separate from the
// line-based laser store, which cannot speak LHYMicro-GL and still sees
// Lihuiyu profiles as file-only. Frame-first holds here as everywhere
// (PROJECT.md non-negotiable 21, ADR-565): Start runs only the footprint a
// completed Frame on this connection traced; advisories are warnings, never
// refusals. The board reports no position, so the store tracks the head from
// Home, jogs and jobs (which return to their start), and forgets it on Abort.

import { create } from 'zustand';
import { encodeLhyFrame, sameLhyFootprint } from '../../../core/controllers/lihuiyu/lhy-frame';
import { LhyLink, type LhySendResult } from '../../../core/controllers/lihuiyu/lhy-link';
import { mmToLhySteps, type LhyPoint } from '../../../core/controllers/lihuiyu/lhy-motion-plan';
import {
  lhyCommandPayload,
  lhyPayloads,
  LHY_STATUS,
} from '../../../core/controllers/lihuiyu/lhy-packet';
import { LhyWriter } from '../../../core/controllers/lihuiyu/lhy-writer';
import {
  LIHUIYU_FRAME_FIRST,
  LIHUIYU_HEAD_MOVED,
  LIHUIYU_HOME_FIRST,
  lihuiyuFailureText,
  lihuiyuLinkLost,
  lihuiyuResetOutcome,
  lihuiyuStatusText,
} from './lihuiyu-usb-messages';
import type {
  LihuiyuUsbFramed,
  LihuiyuUsbJob,
  LihuiyuUsbOpener,
  LihuiyuUsbPhase,
  LihuiyuUsbState,
} from './lihuiyu-usb-types';
import {
  reportLinkMachineStatus,
  reportLinkMachineWork,
  type LinkMachineWork,
} from '../link-machine-work';

type Live = {
  readonly link: LhyLink;
  readonly close: () => Promise<void>;
  unsubscribe: () => void;
  cancel: boolean;
  held: boolean;
  runDone: Promise<unknown>;
};

let live: Live | null = null;

const DISCONNECTED = {
  phase: 'disconnected',
  label: null,
  statusCode: null,
  head: null,
  framed: null,
  sending: null,
  advisories: [],
} as const;

type Set = (partial: Partial<LihuiyuUsbState>) => void;
type Get = () => LihuiyuUsbState;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const useLihuiyuUsbStore = create<LihuiyuUsbState>()((set, get) => ({
  ...DISCONNECTED,
  message: '',
  tone: 'info',
  connect: (open, pause = sleep) => guarded(set, get, () => connect(set, get, open, pause)),
  disconnect: () => guarded(set, get, () => disconnect(set, get)),
  home: () => guarded(set, get, () => home(set, get)),
  jog: (dxMm, dyMm) => guarded(set, get, () => jog(set, get, dxMm, dyMm)),
  frame: (job) => guarded(set, get, () => run(set, get, 'frame', job)),
  start: (job) => guarded(set, get, () => run(set, get, 'job', job)),
  pause: () => guarded(set, get, () => holdOrRelease(set, get, 'running', 'paused')),
  resume: () => guarded(set, get, () => holdOrRelease(set, get, 'paused', 'running')),
  abort: () => guarded(set, get, () => abort(set, get)),
}));

/** A failed USB transfer ends the link: the device is gone or refused it. */
async function guarded(set: Set, get: Get, action: () => Promise<void>): Promise<void> {
  const current = live;
  try {
    await action();
  } catch (error) {
    if (live === null || (current !== null && live !== current)) return;
    linkClosed(set, get, live, error instanceof Error ? error.message : String(error));
  }
}

async function connect(
  set: Set,
  get: Get,
  open: LihuiyuUsbOpener,
  pause: (ms: number) => Promise<void>,
): Promise<void> {
  if (get().phase !== 'disconnected') return;
  set({
    ...DISCONNECTED,
    phase: 'connecting',
    message: 'Choose the K40 board (USB2.0-Print, CH341)…',
    tone: 'info',
  });
  const connection = await open().catch((error: unknown) => {
    set({
      ...DISCONNECTED,
      message: error instanceof Error ? error.message : String(error),
      tone: 'error',
    });
    return null;
  });
  if (connection === null) {
    if (get().phase === 'connecting')
      set({ ...DISCONNECTED, message: 'No board was chosen.', tone: 'info' });
    return;
  }
  const current: Live = {
    link: new LhyLink(connection.channel, { pause }),
    close: connection.close,
    unsubscribe: () => undefined,
    cancel: false,
    held: false,
    runDone: Promise.resolve(),
  };
  live = current;
  current.unsubscribe = connection.onDisconnect(() =>
    linkClosed(set, get, current, 'the board was unplugged'),
  );
  const code = await current.link.status();
  if (live !== current) return;
  if (code === 0) {
    await closeLive(current);
    set({
      ...DISCONNECTED,
      message: 'The board did not answer a status read; nothing was sent.',
      tone: 'error',
    });
    return;
  }
  set({
    phase: 'idle',
    label: connection.label,
    statusCode: code,
    message: `Connected to ${connection.label} (status: ${lihuiyuStatusText(code)}). ${LIHUIYU_HOME_FIRST}`,
    tone: 'info',
  });
}

function linkClosed(set: Set, get: Get, closed: Live, reason: string): void {
  if (live !== closed) return;
  live = null;
  closed.cancel = true;
  closed.unsubscribe();
  // Release the device, so Disconnect or another program can take it (code
  // quality audit C2 D4-P3-1); an unplugged one rejects, which is fine.
  void closed.close().catch(() => undefined);
  const active = ['framing', 'running', 'paused', 'stopping'].includes(get().phase);
  set({ ...DISCONNECTED, message: lihuiyuLinkLost(reason, active), tone: 'error' });
}

async function closeLive(current: Live): Promise<void> {
  if (live === current) live = null;
  current.unsubscribe();
  await current.close().catch(() => undefined);
}

async function disconnect(set: Set, get: Get): Promise<void> {
  const current = live;
  if (current === null) return;
  if (['framing', 'running', 'paused'].includes(get().phase)) await abort(set, get);
  await closeLive(current);
  set({ ...DISCONNECTED, message: 'Disconnected from the board.', tone: 'info' });
}

async function home(set: Set, get: Get): Promise<void> {
  const current = live;
  if (current === null || get().phase !== 'idle') return;
  set({ phase: 'homing', message: 'Homing…', tone: 'info' });
  const result = await current.link.send({ payload: lhyCommandPayload('IPP'), waitFinish: false });
  if (live !== current) return;
  set({
    phase: 'idle',
    head: result.ok ? { x: 0, y: 0 } : null,
    framed: null,
    message: result.ok
      ? 'Home sent: the head is at machine zero.'
      : `Home failed: ${failureOf(result)}`,
    tone: result.ok ? 'info' : 'error',
  });
}

async function jog(set: Set, get: Get, dxMm: number, dyMm: number): Promise<void> {
  const current = live;
  if (current === null || get().phase !== 'idle') return;
  const dx = mmToLhySteps(dxMm);
  const dy = mmToLhySteps(dyMm);
  if (dx === 0 && dy === 0) return;
  const writer = new LhyWriter();
  writer.rapidMove(dx, dy);
  set({ phase: 'jogging', framed: null, message: 'Jogging (laser off)…', tone: 'info' });
  const result = await current.link.stream(lhyPayloads(writer.stream()), {
    cancelled: () => false,
    held: () => false,
  });
  if (live !== current) return;
  const head = get().head;
  set({
    phase: 'idle',
    head: result.ok && head !== null ? { x: head.x + dx, y: head.y + dy } : null,
    message: result.ok ? 'Jog sent.' : `Jog failed: ${failureOf(result)}`,
    tone: result.ok ? 'info' : 'error',
  });
}

async function run(set: Set, get: Get, kind: 'frame' | 'job', job: LihuiyuUsbJob): Promise<void> {
  const current = live;
  if (current === null || get().phase !== 'idle') return;
  const refusal = runRefusal(get(), kind, job);
  if (refusal !== null) {
    set({ message: refusal, tone: 'warning' });
    return;
  }
  const code = await current.link.status();
  if (live !== current || get().phase !== 'idle') return;
  if (code === 0 || code === LHY_STATUS.busy) {
    set({
      statusCode: code,
      message: `The board reports ${lihuiyuStatusText(code)}; nothing was sent.`,
      tone: 'error',
    });
    return;
  }
  const frame = kind === 'frame';
  const bytes = frame ? encodeLhyFrame(job.footprint, job.board, job.framingMmPerMin) : job.stream;
  const phase: LihuiyuUsbPhase = frame ? 'framing' : 'running';
  set({
    phase,
    statusCode: code,
    advisories: frame ? [] : job.advisories,
    message: frame ? 'Framing (laser off)…' : 'Sending the job…',
    tone: 'info',
  });
  current.cancel = false;
  current.held = false;
  const sent = streamTo(set, current, bytes);
  current.runDone = sent;
  finishRun(set, current, kind, job, await sent);
}

function runRefusal(
  state: LihuiyuUsbState,
  kind: 'frame' | 'job',
  job: LihuiyuUsbJob,
): string | null {
  if (job.absolute && state.head === null) return LIHUIYU_HOME_FIRST;
  if (job.absolute && !samePoint(state.head, job.footprint.start)) return LIHUIYU_HEAD_MOVED;
  if (kind === 'job' && !sameFramed(state.framed, job)) return LIHUIYU_FRAME_FIRST;
  return null;
}

function sameFramed(framed: LihuiyuUsbFramed | null, job: LihuiyuUsbJob): boolean {
  return (
    framed !== null &&
    framed.absolute === job.absolute &&
    sameLhyFootprint(framed.footprint, job.footprint)
  );
}

function streamTo(set: Set, current: Live, bytes: Uint8Array): Promise<LhySendResult> {
  const payloads = lhyPayloads(bytes);
  set({ sending: { sent: 0, total: payloads.length } });
  return current.link.stream(payloads, {
    cancelled: () => current.cancel,
    held: () => current.held,
    onProgress: (sent, total) => set({ sending: { sent, total } }),
  });
}

function finishRun(
  set: Set,
  current: Live,
  kind: 'frame' | 'job',
  job: LihuiyuUsbJob,
  result: LhySendResult,
): void {
  // Abort owns a cancelled run; a closed link has nothing left to report.
  if (live !== current || current.cancel) return;
  if (!result.ok) {
    void failRun(set, current, result);
    return;
  }
  set({
    phase: 'idle',
    sending: null,
    ...(kind === 'frame'
      ? { framed: { footprint: job.footprint, absolute: job.absolute } }
      : { advisories: [] }),
    message:
      kind === 'frame'
        ? 'Frame finished. Start is available for this footprint.'
        : 'Job finished: the board reported its finish and the head returned to its start.',
    tone: 'info',
  });
  // "After completed job" variable advance (code quality audit C2 D6-P2-1).
  if (kind === 'job') job.completed?.();
}

/** The board may already run what it received: reset it. */
async function failRun(
  set: Set,
  current: Live,
  result: Extract<LhySendResult, { ok: false }>,
): Promise<void> {
  const reset = await current.link.sendRealtime(lhyCommandPayload('I'));
  if (live !== current) return;
  set({
    phase: 'idle',
    sending: null,
    head: null,
    framed: null,
    advisories: [],
    message: `Sending stopped: ${lihuiyuFailureText(result.failure)} ${lihuiyuResetOutcome(reset.ok)}`,
    tone: 'error',
  });
}

async function holdOrRelease(
  set: Set,
  get: Get,
  from: 'running' | 'paused',
  to: 'running' | 'paused',
): Promise<void> {
  const current = live;
  if (current === null || get().phase !== from) return;
  // Hold the stream before the board pauses, so no packet follows the pause.
  if (to === 'paused') current.held = true;
  const result = await current.link.sendRealtime(lhyCommandPayload('PN'));
  if (live !== current || get().phase !== from) return;
  const verb = to === 'paused' ? 'Pause' : 'Resume';
  if (!result.ok) {
    if (to === 'paused') current.held = false;
    set({
      message: `${verb} was not acknowledged: ${failureOf(result)} Use the machine's switches.`,
      tone: 'error',
    });
    return;
  }
  if (to === 'running') current.held = false;
  set({ phase: to, message: `${verb} acknowledged by the board.`, tone: 'info' });
}

async function abort(set: Set, get: Get): Promise<void> {
  const current = live;
  const phase = get().phase;
  if (current === null || (phase !== 'framing' && phase !== 'running' && phase !== 'paused'))
    return;
  current.cancel = true;
  set({ phase: 'stopping', message: 'Stopping: resetting the board…', tone: 'warning' });
  // The packet in flight gets its verdict first; then the reset goes out.
  await current.runDone;
  const reset = await current.link.sendRealtime(lhyCommandPayload('I'));
  if (live !== current) return;
  current.held = false;
  set({
    phase: 'idle',
    sending: null,
    head: null,
    framed: null,
    advisories: [],
    message: lihuiyuResetOutcome(reset.ok),
    tone: reset.ok ? 'info' : 'error',
  });
}

function failureOf(result: LhySendResult): string {
  return result.ok ? '' : lihuiyuFailureText(result.failure);
}

function samePoint(a: LhyPoint | null, b: LhyPoint): boolean {
  return a !== null && a.x === b.x && a.y === b.y;
}

/** Test support: forget the live link without closing it. */
export function resetLihuiyuUsbStoreForTests(): void {
  if (live !== null) live.cancel = true;
  live = null;
  useLihuiyuUsbStore.setState({ ...DISCONNECTED, message: '', tone: 'info' });
}

// Active work is reported where the always-mounted guards can see it without
// loading this store (link-machine-work.ts; ADR-705 Amendment 6). Abort sends
// the board reset, as the panel's Abort does.
const ACTIVE_WORK: Partial<Record<LihuiyuUsbPhase, LinkMachineWork['activity']>> = {
  homing: 'homing',
  jogging: 'jogging',
  framing: 'framing',
  running: 'running',
  paused: 'paused',
  stopping: 'stopping',
};

useLihuiyuUsbStore.subscribe((state) => {
  const activity = ACTIVE_WORK[state.phase];
  reportLinkMachineStatus('lihuiyu-usb', {
    connected: state.phase !== 'disconnected' && state.phase !== 'connecting',
    framed: state.framed !== null,
  });
  reportLinkMachineWork(
    'lihuiyu-usb',
    activity === undefined
      ? null
      : {
          controller: 'K40',
          activity,
          advisories: state.advisories,
          abort: () => useLihuiyuUsbStore.getState().abort(),
        },
  );
});
