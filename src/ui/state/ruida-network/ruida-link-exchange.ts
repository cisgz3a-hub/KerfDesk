// Drives the pure Ruida session state machine (core ruida-udp-session.ts) over
// one datagram link (ADR-697). The controller speaks only when spoken to and
// one datagram is in flight at a time: send, wait for its ACK (0xCC) or NAK
// (0xCF), and for a DA 00 read wait for one more datagram with the reply
// (meerk40t ruidasession.py _ruida_handshaker, L286-411 at d511944e). A missed
// verdict fails the exchange and nothing is resent: UDP has no sequence
// numbers, so a resend after a lost ACK would run the same commands twice.

import {
  createRuidaSession,
  decodeRuidaReply,
  onRuidaAckTimeout,
  onRuidaResponse,
  ruidaGetSetting,
  stepRuidaSession,
  swizzleBytes,
  RUIDA_ACK_TIMEOUT_MS,
  type RuidaMemoryReply,
  type RuidaSessionFailure,
  type RuidaSessionState,
} from '../../../core/controllers/ruida';
import type { RuidaDatagramLink, RuidaNetworkAdapter } from '../../../platform/types';

export type RuidaExchangeFailure =
  | RuidaSessionFailure
  | 'link-closed'
  | 'send-failed'
  | 'cancelled'
  | 'reply-timeout';

export type RuidaExchangeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: RuidaExchangeFailure; readonly sentPackets: number };

export type RuidaStreamOptions = {
  /** Called after each acknowledged datagram. */
  readonly onProgress?: (acknowledged: number, total: number) => void;
  /** Checked before each new datagram: true stops the stream there. */
  readonly cancelled?: () => boolean;
};

type Arrival =
  | { readonly kind: 'datagram'; readonly datagram: Uint8Array }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'closed' };

// ENQ keepalives and stray bytes are no verdict; a controller that sends only
// those for this many datagrams has not answered.
const MAX_NON_VERDICTS = 8;

export class RuidaLinkExchange {
  private inbox: Uint8Array[] = [];
  private waiter: ((arrival: Arrival) => void) | null = null;
  private closed = false;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly link: RuidaDatagramLink,
    private readonly deadline: RuidaNetworkAdapter['deadline'],
    readonly magic: number,
  ) {
    link.onDatagram((datagram) => this.arrive({ kind: 'datagram', datagram }));
    link.onClose(() => {
      this.closed = true;
      this.arrive({ kind: 'closed' });
    });
  }

  /** Streams a swizzled job, datagram by datagram (ruida-udp-session.ts). */
  stream(swizzled: Uint8Array, options: RuidaStreamOptions = {}): Promise<RuidaExchangeResult> {
    return this.serial(() => this.run(createRuidaSession(swizzled, this.magic), options));
  }

  /** Sends one unswizzled command as its own datagram and waits for its ACK. */
  command(bytes: ReadonlyArray<number>): Promise<RuidaExchangeResult> {
    return this.serial(() =>
      this.run(createRuidaSession(swizzleBytes(bytes, this.magic), this.magic), {}),
    );
  }

  /** Reads one controller memory value (DA 00); null when it did not answer. */
  read(address: number): Promise<RuidaMemoryReply | null> {
    return this.serial(async () => {
      const sent = await this.run(
        createRuidaSession(swizzleBytes(ruidaGetSetting(address), this.magic), this.magic),
        {},
        address,
      );
      if (!sent.ok) return null;
      return this.awaitReply(address);
    });
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async run(
    initial: RuidaSessionState,
    options: RuidaStreamOptions,
    replyAddress?: number,
  ): Promise<RuidaExchangeResult> {
    let state = initial;
    const total = initial.packets.length;
    const fail = (failure: RuidaExchangeFailure): RuidaExchangeResult => ({
      ok: false,
      failure,
      sentPackets: state.nextPacket,
    });
    while (true) {
      const end = this.endOf(state, options);
      if (end === 'done') return { ok: true };
      if (end !== null) return fail(end);
      const step = stepRuidaSession(state);
      state = step.state;
      if (step.toSend === null) continue;
      if (!(await this.send(step.toSend))) return fail('send-failed');
      const verdict = await this.awaitVerdict(state, replyAddress);
      if (verdict.kind === 'closed') return fail('link-closed');
      state = verdict.state;
      if (state.status === 'sending' || state.status === 'done')
        options.onProgress?.(state.nextPacket, total);
    }
  }

  /** Why the run ends before its next datagram, or null to go on. */
  private endOf(
    state: RuidaSessionState,
    options: RuidaStreamOptions,
  ): RuidaExchangeFailure | 'done' | null {
    if (state.status === 'failed') return state.failure ?? 'ack-timeout';
    if (state.status === 'done') return 'done';
    if (this.closed) return 'link-closed';
    return options.cancelled?.() === true ? 'cancelled' : null;
  }

  // Waits for this datagram's verdict, resending it on each NAK the session
  // allows. A reply that arrives before its ACK stands for both, as meerk40t
  // takes it (ruidasession.py: "Reply data when expecting ACK").
  private async awaitVerdict(
    initial: RuidaSessionState,
    replyAddress: number | undefined,
  ): Promise<{ readonly kind: 'state'; readonly state: RuidaSessionState } | { kind: 'closed' }> {
    let state = initial;
    let nonVerdicts = 0;
    while (state.status === 'awaiting-ack') {
      if (nonVerdicts >= MAX_NON_VERDICTS) {
        return { kind: 'state', state: onRuidaAckTimeout(state).state };
      }
      const arrival = await this.next(RUIDA_ACK_TIMEOUT_MS);
      if (arrival.kind === 'closed') return { kind: 'closed' };
      if (arrival.kind === 'timeout') {
        return { kind: 'state', state: onRuidaAckTimeout(state).state };
      }
      const { datagram } = arrival;
      if (datagram.length !== 1) {
        if (replyAddress !== undefined && this.matchesReply(datagram, replyAddress)) {
          this.inbox.unshift(datagram);
          return { kind: 'state', state: { ...state, status: 'done', nextPacket: 1 } };
        }
        nonVerdicts += 1;
        continue;
      }
      const response = onRuidaResponse(state, datagram[0] ?? 0);
      if (response.state === state) nonVerdicts += 1;
      state = response.state;
      if (response.toSend !== null && !(await this.send(response.toSend))) {
        return { kind: 'state', state: onRuidaAckTimeout(state).state };
      }
    }
    return { kind: 'state', state };
  }

  private async awaitReply(address: number): Promise<RuidaMemoryReply | null> {
    for (let attempt = 0; attempt < MAX_NON_VERDICTS; attempt += 1) {
      const arrival = await this.next(RUIDA_ACK_TIMEOUT_MS);
      if (arrival.kind !== 'datagram') return null;
      const reply = decodeRuidaReply(arrival.datagram, this.magic);
      if (reply !== null && reply.address === address) return reply;
    }
    return null;
  }

  private matchesReply(datagram: Uint8Array, address: number): boolean {
    return decodeRuidaReply(datagram, this.magic)?.address === address;
  }

  private async send(datagram: Uint8Array): Promise<boolean> {
    // Anything still queued answered an earlier exchange that gave up on it.
    this.inbox = [];
    try {
      await this.link.send(datagram);
      return true;
    } catch {
      return false;
    }
  }

  private next(timeoutMs: number): Promise<Arrival> {
    const queued = this.inbox.shift();
    if (queued !== undefined) return Promise.resolve({ kind: 'datagram', datagram: queued });
    if (this.closed) return Promise.resolve({ kind: 'closed' });
    return new Promise((resolve) => {
      const cancel = this.deadline(timeoutMs, () => {
        this.waiter = null;
        resolve({ kind: 'timeout' });
      });
      this.waiter = (arrival) => {
        cancel();
        this.waiter = null;
        resolve(arrival);
      };
    });
  }

  private arrive(arrival: Arrival): void {
    const waiter = this.waiter;
    if (waiter !== null) waiter(arrival);
    else if (arrival.kind === 'datagram') this.inbox.push(arrival.datagram);
  }
}
