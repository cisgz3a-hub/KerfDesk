// Main-thread side of src/ui/text/text-render-worker.ts (ADR-643), after
// ADR-609's vector geometry sessions.
//
// One client owns at most one worker. The worker holds the last font file it
// was sent, so a file crosses once per worker (copied: this thread keeps its
// own for the font picker and output) and each later request posts only its
// settings.
//
// Supersede terminates. A newer request retires a busy worker, resolves the
// older request as superseded, and starts the newest one in a fresh worker,
// rather than queuing it behind layout nobody wants any more. An idle worker
// is reused. Every failure retires the worker too, so a later request never
// meets a worker in a state the client does not know.
//
// Failures are told apart as in ADR-609: a worker that cannot start, or cannot
// be handed the work, is `unavailable`; work that started and then failed (a
// thrown error, a crashed worker, an unreadable reply) is `failed`, and is
// never repeated on this thread, where it would fail again and freeze input.
// A module worker whose script cannot be fetched or evaluated still constructs
// and reports that later through onerror, so the worker announces itself once
// its script has run; an error before that is `unavailable`.

import type { TextRenderResult } from '../../core/text/text-to-polylines';
import { unpackTextRenderResult } from './text-render-result-transfer';
import type {
  TextWorkerMessage,
  TextWorkerRequest,
  TextWorkerResponse,
  TextWorkerTask,
} from './text-render-worker-protocol';

export type TextWorkerOutcome<R> =
  | { readonly kind: 'done'; readonly result: R }
  | { readonly kind: 'superseded' }
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

export type TextWorkerResultFor<T extends TextWorkerTask> = T extends { readonly kind: 'render' }
  ? TextRenderResult
  : ReadonlyArray<string>;

export type TextWorkerSpawner = () => Worker | null;

export type TextWorkerFont = { readonly token: number; readonly buffer: ArrayBuffer };

const UNAVAILABLE_MESSAGE = 'The text could not be laid out in the background.';

export const TEXT_WORKER_UNAVAILABLE = {
  kind: 'unavailable',
  message: UNAVAILABLE_MESSAGE,
} as const satisfies TextWorkerOutcome<never>;
const WORKER_ERROR_MESSAGE = 'The background text layout stopped unexpectedly.';
const MESSAGE_ERROR_MESSAGE = 'The background text layout reply could not be read.';

type ActiveRequest = {
  readonly id: number;
  readonly task: TextWorkerTask;
  readonly settle: (outcome: TextWorkerOutcome<unknown>) => void;
};

// Font files are named by identity: the font loader keeps one buffer per font
// for the whole session, so a token never names two different files.
const fontTokens = new WeakMap<ArrayBuffer, number>();
let lastFontToken = 0;

export function textWorkerFont(buffer: ArrayBuffer): TextWorkerFont {
  let token = fontTokens.get(buffer);
  if (token === undefined) {
    lastFontToken += 1;
    token = lastFontToken;
    fontTokens.set(buffer, token);
  }
  return { token, buffer };
}

export class TextWorkerClient {
  private worker: Worker | null = null;
  /** The current worker's script has run (it posted `ready`). */
  private started = false;
  private loadedFont: number | null = null;
  private active: ActiveRequest | null = null;
  private nextId = 0;
  private generation = 0;

  constructor(private readonly spawn: TextWorkerSpawner) {}

  /**
   * Claims the client for a new request before the caller awaits anything:
   * the busy request (if any) is superseded at once. The returned ticket stays
   * current until the next claim or release. Null means no worker can start.
   */
  claim(): number | null {
    this.generation += 1;
    if (this.active !== null) {
      this.settleActive({ kind: 'superseded' });
      this.retire();
    }
    return this.ensureWorker() === null ? null : this.generation;
  }

  isCurrent(ticket: number): boolean {
    return ticket === this.generation;
  }

  run<T extends TextWorkerTask>(
    ticket: number,
    task: T,
    font: TextWorkerFont | undefined,
    signal?: AbortSignal,
  ): Promise<TextWorkerOutcome<TextWorkerResultFor<T>>> {
    return new Promise((resolve) => {
      if (!this.isCurrent(ticket) || signal?.aborted === true) {
        resolve({ kind: 'superseded' });
        return;
      }
      const target = this.ensureWorker();
      if (target === null) {
        resolve(TEXT_WORKER_UNAVAILABLE);
        return;
      }
      this.nextId += 1;
      const id = this.nextId;
      // An aborted caller stops waiting, but the worker keeps its parsed font:
      // the draft aborts on every keystroke, and a render that finishes before
      // the next request leaves an idle, warm worker. A newer claim still
      // retires the worker if this work is running then.
      const abort = (): void => {
        const current = this.active;
        if (current?.id !== id) return;
        this.active = { ...current, settle: () => undefined };
        current.settle({ kind: 'superseded' });
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.active = {
        id,
        task,
        settle: (outcome) => {
          signal?.removeEventListener('abort', abort);
          resolve(outcome as TextWorkerOutcome<TextWorkerResultFor<T>>);
        },
      };
      try {
        this.post(target, id, task, font);
      } catch {
        this.end(TEXT_WORKER_UNAVAILABLE);
      }
    });
  }

  /** Cancels running work and releases the worker. The client stays usable. */
  release(): void {
    this.generation += 1;
    this.cancelActive();
  }

  private cancelActive(): void {
    this.settleActive({ kind: 'superseded' });
    this.retire();
  }

  private settleActive(outcome: TextWorkerOutcome<unknown>): void {
    const current = this.active;
    this.active = null;
    current?.settle(outcome);
  }

  private retire(): void {
    const worker = this.worker;
    if (worker === null) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    this.worker = null;
    this.started = false;
    this.loadedFont = null;
  }

  private end(outcome: Extract<TextWorkerOutcome<unknown>, { readonly message: string }>): void {
    this.retire();
    this.settleActive(outcome);
  }

  private receive(message: TextWorkerMessage): void {
    if (message.kind === 'ready') {
      this.started = true;
      return;
    }
    const response = message;
    const current = this.active;
    if (current === null || response.id !== current.id) return;
    if (response.kind === 'fatal') {
      this.end({ kind: 'failed', message: response.message });
      return;
    }
    let result: unknown;
    try {
      result = taskResult(current.task, response);
    } catch {
      this.end({ kind: 'failed', message: MESSAGE_ERROR_MESSAGE });
      return;
    }
    this.settleActive({ kind: 'done', result });
  }

  private ensureWorker(): Worker | null {
    if (this.worker !== null) return this.worker;
    const created = this.spawn();
    if (created === null) return null;
    created.onmessage = (event: MessageEvent<TextWorkerMessage>) => this.receive(event.data);
    created.onerror = () =>
      this.end(
        this.started ? { kind: 'failed', message: WORKER_ERROR_MESSAGE } : TEXT_WORKER_UNAVAILABLE,
      );
    created.onmessageerror = () => this.end({ kind: 'failed', message: MESSAGE_ERROR_MESSAGE });
    this.worker = created;
    return created;
  }

  private post(
    target: Worker,
    id: number,
    task: TextWorkerTask,
    font: TextWorkerFont | undefined,
  ): void {
    if (font === undefined || this.loadedFont === font.token) {
      const request: TextWorkerRequest = { id, task };
      target.postMessage(request);
      return;
    }
    const request: TextWorkerRequest = { id, task, font };
    target.postMessage(request);
    this.loadedFont = font.token;
  }
}

function taskResult(
  task: TextWorkerTask,
  response: Exclude<TextWorkerResponse, { readonly kind: 'fatal' }>,
): TextRenderResult | ReadonlyArray<string> {
  if (task.kind === 'render' && response.kind === 'rendered')
    return unpackTextRenderResult(response.result);
  if (task.kind === 'missing-characters' && response.kind === 'missing') return response.characters;
  throw new Error('The text worker answered a different task.');
}

export function spawnTextRenderWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./text-render-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}
