// A scripted Moshiboard (ADR-705) for tests. It speaks the EPP side of the
// CH341 link the way MeerK40t's MoshiController expects a board to answer
// (meerk40t/moshi/controller.py at d511944e): status 205 when ready, data
// writes collected between the prologue and epilogue address writes, 207
// while a program runs, and the estop address byte clearing everything. Each
// complete program is decoded with this repo's Moshi decoder and "run": its
// moves and laser states are recorded, which is what tests assert on.
// Nothing here is evidence that a real Moshiboard behaves this way.

import {
  decodeMoshiProgram,
  type MoshiDecodedProgram,
} from '../../core/controllers/moshi/moshi-decoder';
import {
  MOSHI_EPILOGUE_BYTE,
  MOSHI_ESTOP_BYTE,
  MOSHI_PROLOGUE_BYTE,
  MOSHI_STATUS_ERROR,
  MOSHI_STATUS_OK,
  MOSHI_STATUS_PROCESSING,
} from '../../core/controllers/moshi/moshi-live-commands';
import type { MoshiEppPort } from '../../core/controllers/moshi/moshi-link-session';

export type MoshiSimEvent =
  | { readonly kind: 'prologue' }
  | { readonly kind: 'data'; readonly bytes: number }
  | { readonly kind: 'epilogue' }
  | { readonly kind: 'estop' }
  | { readonly kind: 'status'; readonly code: number }
  | { readonly kind: 'unknown-address'; readonly byte: number };

export type MoshiSimRun = {
  readonly program: MoshiDecodedProgram;
  /** False when an estop arrived while the program ran. */
  readonly completed: boolean;
};

export type MoshiSimulatorScript = {
  /** Status reads a program answers 207 before it finishes (default 2). */
  readonly busyReads?: number;
  /** Answer 237 to the next status read before a program. */
  readonly errorBeforeProgram?: boolean;
  /** Answer every status read with this code instead (0: a dead board). */
  readonly fixedStatus?: number;
  /** Called after every data write, e.g. to abort mid-program. */
  readonly onData?: (sim: MoshiSimulator) => void;
};

export class MoshiSimulator implements MoshiEppPort {
  readonly events: MoshiSimEvent[] = [];
  readonly runs: MoshiSimRun[] = [];
  readonly decodeErrors: string[] = [];
  private buffer: number[] = [];
  private receiving = false;
  private running: { program: MoshiDecodedProgram; readsLeft: number } | null = null;
  private errorPending: boolean;

  constructor(private readonly script: MoshiSimulatorScript = {}) {
    this.errorPending = script.errorBeforeProgram === true;
  }

  readonly writeData = async (bytes: Uint8Array): Promise<void> => {
    this.events.push({ kind: 'data', bytes: bytes.length });
    if (this.receiving) this.buffer.push(...bytes);
    this.script.onData?.(this);
  };

  readonly writeAddress = async (bytes: Uint8Array): Promise<void> => {
    for (const byte of bytes) this.address(byte);
  };

  readonly readStatus = async (): Promise<Uint8Array> => {
    const code = this.nextStatus();
    this.events.push({ kind: 'status', code });
    // CH341 status layout: byte 1 carries the board's code (controller.py L780).
    return Uint8Array.of(0, code, 0, 0, 0, 0, 0, 0);
  };

  /** Answer 237 to the next status read outside a program. */
  failNextStatus(): void {
    this.errorPending = true;
  }

  /** The laser-on moves of every completed run, in order. */
  cuts(): ReadonlyArray<{ readonly x: number; readonly y: number }> {
    return this.runs.flatMap((run) =>
      run.program.steps.filter((step) => step.cut).map(({ x, y }) => ({ x, y })),
    );
  }

  private address(byte: number): void {
    if (byte === MOSHI_PROLOGUE_BYTE) {
      this.events.push({ kind: 'prologue' });
      this.buffer = [];
      this.receiving = true;
    } else if (byte === MOSHI_EPILOGUE_BYTE) {
      this.events.push({ kind: 'epilogue' });
      this.receiving = false;
      this.startProgram();
    } else if (byte === MOSHI_ESTOP_BYTE) {
      this.events.push({ kind: 'estop' });
      this.receiving = false;
      this.buffer = [];
      if (this.running !== null)
        this.runs.push({ program: this.running.program, completed: false });
      this.running = null;
    } else {
      this.events.push({ kind: 'unknown-address', byte });
    }
  }

  private startProgram(): void {
    const decoded = decodeMoshiProgram(Uint8Array.from(this.buffer));
    this.buffer = [];
    if (!decoded.ok) {
      this.decodeErrors.push(decoded.error);
      return;
    }
    this.running = { program: decoded.program, readsLeft: this.script.busyReads ?? 2 };
  }

  private nextStatus(): number {
    if (this.script.fixedStatus !== undefined) return this.script.fixedStatus;
    if (this.running !== null) {
      if (this.running.readsLeft > 0) {
        this.running.readsLeft -= 1;
        return MOSHI_STATUS_PROCESSING;
      }
      this.runs.push({ program: this.running.program, completed: true });
      this.running = null;
    }
    if (this.errorPending && !this.receiving) {
      this.errorPending = false;
      return MOSHI_STATUS_ERROR;
    }
    return MOSHI_STATUS_OK;
  }
}
