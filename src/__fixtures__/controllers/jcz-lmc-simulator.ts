// A scripted JCZ LMC galvo board (ADR-704) behind the USB transfer calls of an
// ADR-702 UsbLinkSession. It takes 12-byte single commands on bulk OUT
// endpoint 2 and answers each with 8 bytes on IN endpoint 8 (Write Cor Line
// gets none, as MeerK40t never reads one), takes 0xC00-byte lists without a
// reply, and runs what it was sent after Execute List for a scripted number of
// status reads. Get Version reports Ready and Busy, Get List Status running and
// paused; Stop List pauses, Restart List resumes, Stop Execute ends a run. It
// decodes every executed program with the core decoder, so tests can check
// the marks and jumps a job sent. Simulator evidence only: not a real board.

import { decodeLmcProgram, type DecodedLmcProgram } from '../../core/controllers/jcz/lmc-decoder';
import {
  LMC_COMMAND_BYTES,
  LMC_ENDPOINT_IN,
  LMC_ENDPOINT_OUT,
  LMC_EXECUTE_LIST,
  LMC_FIBER_SET_MO,
  LMC_GET_LIST_STATUS,
  LMC_GET_SERIAL_NO,
  LMC_GET_VERSION,
  LMC_LIST_BYTES,
  LMC_LIST_PAUSED,
  LMC_LIST_RUNNING,
  LMC_RESET_LIST,
  LMC_RESTART_LIST,
  LMC_STATUS_BUSY,
  LMC_STATUS_READY,
  LMC_STOP_EXECUTE,
  LMC_STOP_LIST,
  LMC_USB_PRODUCT_ID,
  LMC_USB_VENDOR_ID,
  LMC_WRITE_COR_LINE,
  LMC_WRITE_PORT,
} from '../../core/controllers/jcz/lmc-opcodes';
import {
  decodeLmcPacket,
  lmcReplyBytes,
  type LmcDecodedCommand,
} from '../../core/controllers/jcz/lmc-packets';

export type JczSimulatorScript = {
  /** Status reads a program runs for after Execute List. */
  readonly runReads?: number;
  /** Get Version reads that report not-Ready at first and after each run. */
  readonly notReadyReads?: number;
  /** Single commands whose reply never arrives (a lost reply). */
  readonly silentOpcodes?: ReadonlyArray<number>;
};

type Pending = { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void };

export class JczLmcSimulator {
  readonly info = { vendorId: LMC_USB_VENDOR_ID, productId: LMC_USB_PRODUCT_ID };
  /** Every single command received, in order. */
  readonly singles: LmcDecodedCommand[] = [];
  /** Every list packet received, in order. */
  readonly lists: Uint8Array[] = [];
  /** Each program that ran to its end, decoded. */
  readonly completed: DecodedLmcProgram[] = [];
  /** Each program Stop Execute ended, decoded as far as it was sent. */
  readonly stopped: DecodedLmcProgram[] = [];
  portBits = 0;
  masterOscillatorOpen = false;
  correctionLines = 0;
  private loaded: Uint8Array[] = [];
  private running = false;
  private paused = false;
  private readsLeft = 0;
  private notReadyLeft = 0;
  private readonly replies: Uint8Array[] = [];
  private readonly waiting: Pending[] = [];
  private disconnectHandlers: Array<() => void> = [];
  private closed = false;

  constructor(private script: JczSimulatorScript = {}) {
    this.notReadyLeft = script.notReadyReads ?? 0;
  }

  /** Changes how many status reads later programs run for. */
  setRunReads(runReads: number): void {
    this.script = { ...this.script, runReads };
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  async transferOut(endpointNumber: number, bytes: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('The device is closed.');
    if (endpointNumber !== LMC_ENDPOINT_OUT) throw new Error(`OUT endpoint ${endpointNumber}`);
    if (bytes.byteLength === LMC_LIST_BYTES) {
      const copy = bytes.slice();
      this.lists.push(copy);
      this.loaded.push(copy);
      return;
    }
    if (bytes.byteLength !== LMC_COMMAND_BYTES) throw new Error(`${bytes.byteLength}-byte packet`);
    const [command] = decodeLmcPacket(bytes) ?? [];
    if (command === undefined) return;
    this.singles.push(command);
    const reply = this.apply(command);
    if (reply !== null && !(this.script.silentOpcodes ?? []).includes(command.opcode))
      this.reply(reply);
  }

  transferIn(endpointNumber: number, length: number): Promise<Uint8Array> {
    if (this.closed) return Promise.reject(new Error('The device is closed.'));
    if (endpointNumber !== LMC_ENDPOINT_IN || length !== 8)
      return Promise.reject(new Error(`IN endpoint ${endpointNumber}, ${length} bytes`));
    const ready = this.replies.shift();
    if (ready !== undefined) return Promise.resolve(ready);
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }

  onDisconnect(handler: () => void): () => void {
    this.disconnectHandlers.push(handler);
    return () => {
      this.disconnectHandlers = this.disconnectHandlers.filter((entry) => entry !== handler);
    };
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async forget(): Promise<void> {
    this.closed = true;
  }

  /** The cable is pulled: pending reads fail and disconnect handlers run. */
  unplug(): void {
    this.closed = true;
    for (const pending of this.waiting.splice(0)) pending.reject(new Error('Device unplugged.'));
    for (const handler of this.disconnectHandlers) handler();
  }

  /** The singles received with this opcode, in order. */
  sent(opcode: number): ReadonlyArray<LmcDecodedCommand> {
    return this.singles.filter((command) => command.opcode === opcode);
  }

  private reply(words: readonly [number, number, number, number]): void {
    const bytes = lmcReplyBytes(words);
    const pending = this.waiting.shift();
    if (pending !== undefined) pending.resolve(bytes);
    else this.replies.push(bytes);
  }

  private apply(command: LmcDecodedCommand): readonly [number, number, number, number] | null {
    switch (command.opcode) {
      case LMC_WRITE_COR_LINE:
        this.correctionLines += 1;
        return null;
      case LMC_GET_SERIAL_NO:
        return [0x4b44, 0x0001, 0x0002, 0x0003];
      case LMC_GET_VERSION:
        return [0x0001, 0x0000, 0x0000, this.statusWord()];
      case LMC_GET_LIST_STATUS:
        this.tick();
        return [
          0,
          0,
          0,
          (this.running ? LMC_LIST_RUNNING : 0) | (this.paused ? LMC_LIST_PAUSED : 0),
        ];
    }
    this.applyControl(command);
    return [0, 0, 0, this.statusWord()];
  }

  // The commands that change the board's state; each is answered with status.
  private applyControl(command: LmcDecodedCommand): void {
    const [p1] = command.params;
    switch (command.opcode) {
      case LMC_EXECUTE_LIST:
        this.running = true;
        this.readsLeft = this.script.runReads ?? 3;
        break;
      case LMC_STOP_EXECUTE:
        if (this.running) this.stopped.push(decodeLmcProgram(this.loaded));
        this.running = false;
        this.paused = false;
        break;
      case LMC_STOP_LIST:
        if (this.running) this.paused = true;
        break;
      case LMC_RESTART_LIST:
        this.paused = false;
        break;
      case LMC_RESET_LIST:
        this.loaded = [];
        break;
      case LMC_WRITE_PORT:
        this.portBits = p1;
        break;
      case LMC_FIBER_SET_MO:
        this.masterOscillatorOpen = p1 === 1;
        break;
    }
  }

  private statusWord(): number {
    if (this.notReadyLeft > 0) {
      this.notReadyLeft -= 1;
      return this.running ? LMC_STATUS_BUSY : 0;
    }
    this.tick();
    return LMC_STATUS_READY | (this.running ? LMC_STATUS_BUSY : 0);
  }

  // A running program advances one status read at a time, held while paused,
  // and ends only once its End of List has arrived.
  private tick(): void {
    if (!this.running || this.paused) return;
    if (this.readsLeft > 0) this.readsLeft -= 1;
    if (this.readsLeft > 0 || !decodeLmcProgram(this.loaded).ended) return;
    this.running = false;
    this.completed.push(decodeLmcProgram(this.loaded));
    this.loaded = [];
    this.notReadyLeft = this.script.notReadyReads ?? 0;
  }
}
