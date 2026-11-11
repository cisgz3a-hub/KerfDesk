// Running Moshi programs over a CH341 EPP port (ADR-705), the loop MeerK40t's
// MoshiController runs (meerk40t/moshi/controller.py `_thread_data_send`
// L597-695 at d511944e, MIT), one program at a time:
//   1. poll status until OK (205); an error (237) or a dead read (0) fails
//      (`wait_until_accepting_packets` L761-791);
//   2. prologue address write, then the program as 32-byte data packets with
//      no status check between them (L642-654, `process_buffer` L697-719);
//   3. one status read, then the epilogue address write (L655-656);
//   4. poll until OK again, every 0.5 s while it reports busy (`wait_finished`
//      L793-838).
// The port is an interface so the store, the simulator and the foundation's
// CH341 driver meet here; nothing in this module touches USB itself.

import {
  MOSHI_BUSY_POLL_MS,
  MOSHI_EPILOGUE_BYTE,
  MOSHI_PROLOGUE_BYTE,
  MOSHI_READY_POLL_MS,
  MOSHI_STATUS_ERROR,
  MOSHI_STATUS_OK,
  MOSHI_STATUS_PROCESSING,
  moshiPackets,
  moshiStatusCode,
} from './moshi-live-commands';

/** What the run needs from the USB side: EPP data and address writes and the
 *  board's status bytes. Each call rejects when the link fails. */
export type MoshiEppPort = {
  readonly writeData: (bytes: Uint8Array) => Promise<void>;
  readonly writeAddress: (bytes: Uint8Array) => Promise<void>;
  readonly readStatus: () => Promise<Uint8Array>;
};

export type MoshiRunFailure =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'board-error'; readonly code: number }
  | { readonly kind: 'no-status' }
  | { readonly kind: 'link-failed'; readonly reason: string }
  | { readonly kind: 'timed-out'; readonly code: number | null };

export type MoshiRunResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly failure: MoshiRunFailure;
      /** Programs the board had been sent in full before the failure. */
      readonly programsSent: number;
    };

export type MoshiRunOptions = {
  readonly cancelled: () => boolean;
  readonly wait: (ms: number) => Promise<void>;
  readonly onStatus?: (code: number | null) => void;
  readonly onProgress?: (sentBytes: number, totalBytes: number) => void;
  /** Most status reads one wait may take before it gives up (default: none). */
  readonly maxPolls?: number;
};

type Wait = { readonly ok: true } | { readonly ok: false; readonly failure: MoshiRunFailure };

export async function runMoshiPrograms(
  port: MoshiEppPort,
  programs: ReadonlyArray<Uint8Array>,
  options: MoshiRunOptions,
): Promise<MoshiRunResult> {
  const totalBytes = programs.reduce((sum, program) => sum + program.length, 0);
  let sentBytes = 0;
  let programsSent = 0;
  try {
    for (const program of programs) {
      const ready = await waitForOk(port, options, MOSHI_READY_POLL_MS, 'ready');
      if (!ready.ok) return { ok: false, failure: ready.failure, programsSent };
      await port.writeAddress(Uint8Array.of(MOSHI_PROLOGUE_BYTE));
      for (const packet of moshiPackets(program)) {
        if (options.cancelled()) return { ok: false, failure: { kind: 'cancelled' }, programsSent };
        await port.writeData(packet);
        sentBytes += packet.length;
        options.onProgress?.(sentBytes, totalBytes);
      }
      // Read first: an optional call would skip its argument, and the read.
      const sentStatus = moshiStatusCode(await port.readStatus());
      options.onStatus?.(sentStatus);
      await port.writeAddress(Uint8Array.of(MOSHI_EPILOGUE_BYTE));
      programsSent += 1;
      const finished = await waitForOk(port, options, MOSHI_BUSY_POLL_MS, 'finish');
      if (!finished.ok) return { ok: false, failure: finished.failure, programsSent };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, failure: { kind: 'link-failed', reason }, programsSent };
  }
  return { ok: true };
}

/** Polls until the board reports OK. Before a program an error status or a
 *  dead read fails at once (L780-786); while one runs, MeerK40t reopens the
 *  link on a dead read (L824-827), which this link cannot do, so it fails. */
async function waitForOk(
  port: MoshiEppPort,
  options: MoshiRunOptions,
  busyIntervalMs: number,
  stage: 'ready' | 'finish',
): Promise<Wait> {
  let code: number | null = null;
  for (let poll = 0; options.maxPolls === undefined || poll < options.maxPolls; poll += 1) {
    if (options.cancelled()) return { ok: false, failure: { kind: 'cancelled' } };
    code = moshiStatusCode(await port.readStatus());
    options.onStatus?.(code);
    if (code === MOSHI_STATUS_OK) return { ok: true };
    if (code === null || code === 0) return { ok: false, failure: { kind: 'no-status' } };
    if (code === MOSHI_STATUS_ERROR && stage === 'ready')
      return { ok: false, failure: { kind: 'board-error', code } };
    await options.wait(code === MOSHI_STATUS_PROCESSING ? busyIntervalMs : MOSHI_READY_POLL_MS);
  }
  return { ok: false, failure: { kind: 'timed-out', code } };
}

export function moshiRunFailureText(failure: MoshiRunFailure): string {
  switch (failure.kind) {
    case 'cancelled':
      return 'Stopped by Abort.';
    case 'board-error':
      return `The board reported an error (status ${failure.code}).`;
    case 'no-status':
      return 'The board gave no status: check the USB cable and that the machine is on.';
    case 'link-failed':
      return `The USB link failed: ${failure.reason}`;
    case 'timed-out':
      return 'The board did not report ready in time.';
  }
}
