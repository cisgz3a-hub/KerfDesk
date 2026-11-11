// The host side of a Lihuiyu USB link (ADR-703): MeerK40t's MIT
// controller.py process_queue loop (meerk40t/lihuiyu/controller.py at
// d511944e, L644-875), reimplemented over a channel that writes EPP data and
// reads the six status bytes (the CH341 bridge, ADR-702).
//
// For each job packet: unless the last one was confirmed OK, wait until the
// board reports OK (wait_until_accepting_packets); write it; then read status
// until OK confirms it. BUSY keeps reading, ERROR means the CRC failed and the
// packet is sent again, FINISH is not a confirmation. A packet whose stream
// asked for it ('-') then waits until the board reports finished
// (wait_finished). Each USB exchange runs alone, but the waits release the
// link between reads, so a realtime packet (pause, resume, reset) can go out
// while a job packet waits. A realtime packet does not wait for room: a
// paused board with a full buffer never makes any (MeerK40t puts realtime
// packets first in its queue instead).

import { lhyPacket, lhyStatusFinished, LHY_STATUS, type LhyPayload } from './lhy-packet';

/** What the link needs from the USB bridge (Ch341Epp, ADR-702). */
export type LhyChannel = {
  readonly writeData: (bytes: Uint8Array) => Promise<void>;
  readonly readStatus: () => Promise<Uint8Array>;
};

export type LhyLinkFailure = 'cancelled' | 'no-status' | 'rejected';

export type LhySendResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: LhyLinkFailure };

export type LhyLinkOptions = {
  /** Sleeps between status reads; tests pass one that resolves at once. */
  readonly pause: (ms: number) => Promise<void>;
  /** Reads of status 0 in a row before the link counts as broken (MeerK40t: 500). */
  readonly maxSilentReads?: number;
  /** Sends of one packet the board rejects before giving up. */
  readonly maxRejects?: number;
};

export type LhyStreamOptions = {
  readonly cancelled: () => boolean;
  /** While true, no further packet is sent (the host half of Pause). */
  readonly held: () => boolean;
  readonly onProgress?: (sent: number, total: number) => void;
};

const NEVER = (): boolean => false;
const CANCELLED: LhySendResult = { ok: false, failure: 'cancelled' };
const NO_STATUS: LhySendResult = { ok: false, failure: 'no-status' };
const OK: LhySendResult = { ok: true };

export class LhyLink {
  private preOk = false;
  /** The board reported its finish while the last packet was being confirmed. */
  private finishSeen = false;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly maxSilentReads: number;
  private readonly maxRejects: number;

  constructor(
    private readonly channel: LhyChannel,
    private readonly options: LhyLinkOptions,
  ) {
    this.maxSilentReads = options.maxSilentReads ?? 500;
    this.maxRejects = options.maxRejects ?? 5;
  }

  /** One status read: byte 1 of the six status bytes, 0 when there is none. */
  status(): Promise<number> {
    return this.exclusive(async () => (await this.channel.readStatus())[1] ?? 0);
  }

  /** Sends one job payload, confirmed; then waits for the board's finish when asked. */
  async send(item: LhyPayload, cancelled: () => boolean = NEVER): Promise<LhySendResult> {
    for (let attempt = 0; attempt < this.maxRejects; attempt += 1) {
      const sent = await this.sendOnce(item.payload, cancelled);
      if (sent === 'rejected') continue;
      // A finish read while confirming already answers the wait (process_queue L791-795).
      if (!sent.ok || !item.waitFinish || this.finishSeen) return sent;
      return this.waitFinished(cancelled);
    }
    return { ok: false, failure: 'rejected' };
  }

  /** Sends a realtime payload (pause/resume "PN", reset "I") without waiting for room. */
  async sendRealtime(payload: Uint8Array): Promise<LhySendResult> {
    const packet = lhyPacket(payload);
    for (let attempt = 0; attempt < this.maxRejects; attempt += 1) {
      await this.write(packet);
      this.preOk = false;
      const code = await this.firstCode(NEVER);
      if (code === 0) return NO_STATUS;
      if (code !== LHY_STATUS.error) return OK;
    }
    return { ok: false, failure: 'rejected' };
  }

  /** Sends every payload in order, holding while `held()` and stopping on `cancelled()`. */
  async stream(
    payloads: ReadonlyArray<LhyPayload>,
    options: LhyStreamOptions,
  ): Promise<LhySendResult> {
    for (let index = 0; index < payloads.length; index += 1) {
      while (options.held() && !options.cancelled()) await this.options.pause(50);
      if (options.cancelled()) return CANCELLED;
      const item = payloads[index];
      if (item === undefined) continue;
      const result = await this.send(item, options.cancelled);
      if (!result.ok) return result;
      options.onProgress?.(index + 1, payloads.length);
    }
    return OK;
  }

  private async sendOnce(
    payload: Uint8Array,
    cancelled: () => boolean,
  ): Promise<LhySendResult | 'rejected'> {
    if (!this.preOk) {
      const ready = await this.waitUntilAccepting(cancelled);
      if (ready !== null) return ready;
    }
    if (cancelled()) return CANCELLED;
    await this.write(lhyPacket(payload));
    this.preOk = false;
    this.finishSeen = false;
    return this.confirm(cancelled);
  }

  private async confirm(cancelled: () => boolean): Promise<LhySendResult | 'rejected'> {
    let silent = 0;
    for (let reads = 0; ; reads += 1) {
      const code = await this.status();
      if (code === LHY_STATUS.ok) {
        this.preOk = true;
        return OK;
      }
      if (code === LHY_STATUS.error) return 'rejected';
      if (lhyStatusFinished(code)) this.finishSeen = true;
      silent = code === 0 ? silent + 1 : 0;
      if (silent >= this.maxSilentReads) return NO_STATUS;
      if (cancelled()) return CANCELLED;
      if (reads > 10) await this.options.pause(Math.min(reads, 100));
    }
  }

  /** Reads until the board reports OK; null when it may take the packet. */
  private async waitUntilAccepting(cancelled: () => boolean): Promise<LhySendResult | null> {
    for (;;) {
      const code = await this.status();
      if (code === 0) return NO_STATUS;
      if (code === LHY_STATUS.ok || code === LHY_STATUS.error) return null;
      if (cancelled()) return CANCELLED;
      await this.options.pause(50);
    }
  }

  /** Reads until status bit 1 clears (FINISH). */
  private async waitFinished(cancelled: () => boolean): Promise<LhySendResult> {
    for (;;) {
      if (cancelled()) return CANCELLED;
      const code = await this.status();
      if (code === 0) return NO_STATUS;
      if (lhyStatusFinished(code)) {
        this.preOk = false;
        return OK;
      }
      await this.options.pause(1);
    }
  }

  /** The first non-zero status code, or 0 after the silent-read limit. */
  private async firstCode(cancelled: () => boolean): Promise<number> {
    for (let reads = 0; reads < this.maxSilentReads && !cancelled(); reads += 1) {
      const code = await this.status();
      if (code !== 0) return code;
    }
    return 0;
  }

  private write(packet: Uint8Array): Promise<void> {
    return this.exclusive(() => this.channel.writeData(packet));
  }

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = this.tail.then(run, run);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
