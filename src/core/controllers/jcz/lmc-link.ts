// One USB conversation with an LMC board (ADR-704). A single command is
// written to bulk OUT endpoint 2 and, unless MeerK40t sends it without reading
// (Write Cor Line, controller.py L1530-1531), answered by 8 bytes from bulk IN
// endpoint 8 (controller.py L421-441; usb_connection.py L272-301). A list
// packet is written with no reply read (controller.py L578). Exchanges run one
// at a time, so a status poll never splits another command from its reply.
// The transport is ADR-702's UsbLinkSession transfer pair, typed here
// structurally so core never imports the platform layer.

import { errorMessage } from '../../util/error-message';
import {
  LMC_ENDPOINT_IN,
  LMC_ENDPOINT_OUT,
  LMC_GET_LIST_STATUS,
  LMC_GET_VERSION,
  LMC_LIST_BYTES,
  LMC_LIST_PAUSED,
  LMC_LIST_RUNNING,
  LMC_REPLY_BYTES,
  LMC_STATUS_BUSY,
  LMC_STATUS_READY,
} from './lmc-opcodes';
import { lmcCommand, readLmcReply, type LmcParams, type LmcReply } from './lmc-packets';

/** The transfer calls of an open USB session (platform/usb-link-types.ts). */
export type LmcUsbTransport = {
  readonly transferOut: (endpointNumber: number, bytes: Uint8Array) => Promise<unknown>;
  readonly transferIn: (endpointNumber: number, length: number) => Promise<Uint8Array>;
};

export type LmcBoardStatus = {
  readonly word: number;
  readonly busy: boolean;
  readonly ready: boolean;
};

export type LmcListState = 'running' | 'paused' | 'idle';

export type LmcLinkOptions = {
  /** How long a reply may take before the exchange fails. */
  readonly replyTimeoutMs?: number;
};

const DEFAULT_REPLY_TIMEOUT_MS = 2000;

export class LmcLink {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly replyTimeoutMs: number;
  private failedWith: string | null = null;

  constructor(
    private readonly transport: LmcUsbTransport,
    options: LmcLinkOptions = {},
  ) {
    this.replyTimeoutMs = options.replyTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS;
  }

  /** Why the last exchange failed, or null. */
  get lastFailure(): string | null {
    return this.failedWith;
  }

  /** A single command and its 8-byte reply; null when either failed. */
  command(opcode: number, ...params: LmcParams): Promise<LmcReply | null> {
    return this.exclusive(async () => {
      if (!(await this.write(lmcCommand(opcode, ...params)))) return null;
      return this.readReply();
    });
  }

  /** A single command MeerK40t sends without reading a reply. */
  commandWithoutReply(opcode: number, ...params: LmcParams): Promise<boolean> {
    return this.exclusive(() => this.write(lmcCommand(opcode, ...params)));
  }

  /** One 0xC00-byte list packet; no reply is read. */
  sendList(list: Uint8Array): Promise<boolean> {
    if (list.byteLength !== LMC_LIST_BYTES) throw new RangeError('An LMC list is 0xC00 bytes.');
    return this.exclusive(() => this.write(list));
  }

  /** The board status word MeerK40t reads through Get Version (L443-445, L771-787). */
  async boardStatus(): Promise<LmcBoardStatus | null> {
    const reply = await this.command(LMC_GET_VERSION);
    if (reply === null) return null;
    const word = reply[3];
    return { word, busy: (word & LMC_STATUS_BUSY) !== 0, ready: (word & LMC_STATUS_READY) !== 0 };
  }

  /** Get List Status word 3: running and paused bits (controller.py L1496-1514). */
  async listState(): Promise<LmcListState | null> {
    const reply = await this.command(LMC_GET_LIST_STATUS);
    if (reply === null) return null;
    if ((reply[3] & LMC_LIST_PAUSED) !== 0) return 'paused';
    return (reply[3] & LMC_LIST_RUNNING) !== 0 ? 'running' : 'idle';
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async write(bytes: Uint8Array): Promise<boolean> {
    try {
      await this.transport.transferOut(LMC_ENDPOINT_OUT, bytes);
      this.failedWith = null;
      return true;
    } catch (error) {
      this.failedWith = `USB write failed: ${errorMessage(error)}`;
      return false;
    }
  }

  private async readReply(): Promise<LmcReply | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.replyTimeoutMs);
    });
    try {
      const result = await Promise.race([
        this.transport.transferIn(LMC_ENDPOINT_IN, LMC_REPLY_BYTES),
        timeout,
      ]);
      if (result === 'timeout') {
        this.failedWith = `The board did not answer within ${this.replyTimeoutMs} ms.`;
        return null;
      }
      const reply = readLmcReply(result);
      this.failedWith =
        reply === null ? `The board answered ${result.byteLength} bytes, not 8.` : null;
      return reply;
    } catch (error) {
      this.failedWith = `USB read failed: ${errorMessage(error)}`;
      return null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
