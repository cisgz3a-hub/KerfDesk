/**
 * T3-15: streaming G-code output API foundation.
 *
 * Pre-T3-15 the entire G-code job lives in memory at 8 stages
 * (`OutputStrategy.lines`, `Output.text`, encoded bytes for
 * `fileSizeBytes`, `Pipeline.gcodeLines`, `ValidatedJobTicket.gcodeText`
 * + `gcodeLines`, `GrblController._jobLines` + `_lineMarkers`, plus the
 * preview's parsed moves). For a 50MB job the cumulative footprint is
 * 250-400MB; a 500MB job runs out of memory before streaming begins.
 *
 * Audit 2E Priority 1 calls for replacing `OutputStrategy.generate`
 * with `generateGcode(plan, job): AsyncIterable<GcodeChunk>` so the
 * generator and the controller's stream-consumer pull chunks rather
 * than holding the full array. This is a multi-week architectural
 * change touching every output strategy (today: GRBL; future: Marlin),
 * the ticket model (hash + line count + bounds replace `gcodeText`),
 * the controller (sendJob accepts an async iterable), the preview
 * (samples from the same spool), the simulator (consumes from the
 * spool), and every validator that scans output lines.
 *
 * This module began as the type foundation for the spool migration.
 * It defines the `GcodeChunk`, `StreamingOutputStrategy`, and
 * `SpoolHandle` contracts plus pure utility helpers (`chunkArrayBy`,
 * `collectStreamingOutput`) so the migration has a stable target.
 * After T3-34's chunked GRBL output slice, `BaseGCodeStrategy`
 * implements `generateGcode(...)`; `PipelineService.compileGcode` drains
 * that iterable through `collectStreamingOutput` when a strategy
 * supports it. The first T3-15 spool slices added replayable
 * `ValidatedJobTicket.gcodeSpool` metadata and a `ControllerOutput`
 * `gcode-stream` handoff, so MachineService can pass a spool to the
 * controller boundary without inventing a second ticket model. The GRBL
 * path now parses and bounds-checks spool chunks with stateful helpers,
 * feeds the serial sender from a bounded queue window, and replays the
 * simulator fan-out from the spool without reading legacy
 * `ticket.gcodeLines` on the spooled start path. Streaming strategies
 * now also build ticket spools directly from `generateGcode(...)`
 * instead of from the already-split legacy line array, and compile
 * materializes its temporary legacy text by reopening that spool instead
 * of running the strategy a second time. Ticket validation now prefers
 * the spool content hash over legacy `gcodeText`; compile-time burn
 * envelope/divergence analysis and MachineService job-time estimation
 * consume the spool stream, and the GRBL firmware adapter emits a
 * replayable `gcode-stream` artifact. The remaining T3-15 work is still
 * real: `gcodeText` / `gcodeLines`, compile-time text collection,
 * preview parsing, and legacy `sendJob(string[])` still materialize full
 * jobs until those callers move fully onto spool handles.
 *
 * Pairs with T3-44 (multi-domain progress already shipped — the
 * progress shape supports byte-domain upload progress that a
 * file-upload streaming controller would emit) and T3-34 (stripe-
 * based raster G-code emission depends on T3-15).
 */

import type { Job } from '../job/Job';
import type { Plan } from '../plan/Plan';

/**
 * One chunk of streamed G-code. Producers emit chunks in line-order;
 * consumers concatenate by appending `lines`. The `cumulativeLineCount`
 * is the running count INCLUDING this chunk's lines (so the last
 * chunk's value equals the total job line count).
 */
export interface GcodeChunk {
  /** Lines in this chunk. Empty array allowed for header-only chunks. */
  readonly lines: readonly string[];
  /** Running line count including this chunk. */
  readonly cumulativeLineCount: number;
  /** `true` for the terminal chunk; `false` for all preceding chunks. */
  readonly isLast: boolean;
}

/** Generation options shared with the future streaming + legacy paths. */
export interface GcodeGenerateOptions {
  /**
   * Target chunk size in lines. The producer SHOULD respect this as
   * a soft target; emitting smaller chunks is allowed for natural
   * boundaries (header / footer / end-of-pass). Default 1000 lines.
   */
  readonly chunkLines?: number;
  /**
   * Cooperative cancellation. When the signal aborts, the producer
   * should stop yielding chunks at the next safe boundary. The
   * consumer is responsible for draining any remaining buffered
   * chunks; the producer should never throw the abort error itself,
   * to keep the iterable contract clean.
   */
  readonly signal?: AbortSignal;
}

/**
 * Future replacement for `OutputStrategy.generate`. Returns an
 * `AsyncIterable<GcodeChunk>` that the controller / validator /
 * preview consume. Concrete implementations decide whether to back
 * the spool with a temp file, a fixed-size in-memory ring, or a
 * direct generator.
 */
export interface StreamingOutputStrategy {
  /** Identity of the strategy ('grbl', 'marlin', etc.). Mirrors the legacy `OutputStrategy.format`. */
  readonly format: string;

  /**
   * Stream chunks of G-code derived from `plan` + `job`. The async
   * iterable is single-use; consumers iterate exactly once.
   */
  generateGcode(
    plan: Plan,
    job: Job,
    options?: GcodeGenerateOptions,
  ): AsyncIterable<GcodeChunk>;
}

/**
 * Handle returned by a streaming output's spool persistence layer.
 * Stores hash + line count + bounds in lieu of the full text — the
 * same fields the validated ticket model needs for integrity checks
 * without re-loading the entire job into memory.
 */
export interface SpoolHandle {
  /** Stable identifier for the spooled job. */
  readonly id: string;
  /** SHA-256 hex of the canonical UTF-8 byte stream. */
  readonly contentHash: string;
  /** Total line count. */
  readonly lineCount: number;
  /** Approximate byte count of the canonical UTF-8 stream. */
  readonly byteCount: number;
  /**
   * Re-open the spool for streaming consumption. Each call returns a
   * fresh single-use async iterable. Implementations may serve from
   * a temp file, an in-memory cache, or by re-running the producer.
   */
  open(options?: GcodeGenerateOptions): AsyncIterable<GcodeChunk>;
}

export type ReplayableGcodeChunkFactory = (options?: GcodeGenerateOptions) => AsyncIterable<GcodeChunk>;

function hashCharsFnv1a(hash: number, text: string): number {
  let h = hash >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function utf8ByteLength(text: string): number {
  return typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(text).byteLength
    : text.length;
}

/**
 * Build a replayable spool handle from a deterministic chunk factory without
 * collecting the job into a flat `string[]`.
 *
 * The first pass streams through the factory to compute line count, byte count,
 * and a stable content fingerprint. Later `open()` calls invoke the factory
 * again, giving consumers a fresh single-use stream. This is the first T3-15
 * migration primitive: it proves ticket/controller boundaries can depend on a
 * replayable stream handle before the GRBL sender itself stops using arrays.
 */
export async function buildReplayableGcodeSpool(
  id: string,
  factory: ReplayableGcodeChunkFactory,
  options: GcodeGenerateOptions = {},
): Promise<SpoolHandle> {
  let lineCount = 0;
  let byteCount = 0;
  let hash = 0x811c9dc5 >>> 0;
  let wroteLine = false;
  let sawLast = false;

  for await (const chunk of factory(options)) {
    if (options.signal?.aborted) break;
    for (const line of chunk.lines) {
      if (wroteLine) {
        hash = hashCharsFnv1a(hash, '\n');
        byteCount += 1;
      }
      hash = hashCharsFnv1a(hash, line);
      byteCount += utf8ByteLength(line);
      lineCount++;
      wroteLine = true;
    }
    if (chunk.cumulativeLineCount !== lineCount) {
      throw new Error(
        `Spool ${id} reported cumulativeLineCount=${chunk.cumulativeLineCount} `
        + `after ${lineCount} streamed line(s).`,
      );
    }
    if (chunk.isLast) {
      sawLast = true;
      break;
    }
  }

  if (!options.signal?.aborted && !sawLast) {
    throw new Error(`Spool ${id} ended before the terminal chunk.`);
  }

  return {
    id,
    contentHash: (hash >>> 0).toString(16).padStart(8, '0'),
    lineCount,
    byteCount,
    open: (openOptions?: GcodeGenerateOptions) => factory(openOptions),
  };
}

/**
 * Pure helper: split a flat `lines` array into `GcodeChunk`s of at
 * most `chunkLines` lines each. The last chunk has `isLast: true`;
 * all earlier chunks have `isLast: false`. `cumulativeLineCount`
 * counts up monotonically.
 *
 * Used today by adapters that bridge the legacy `Output.lines`
 * shape into the streaming consumer surface — and as a reference
 * implementation for future native streaming generators.
 */
export function chunkArrayBy(
  lines: readonly string[],
  chunkLines: number,
): readonly GcodeChunk[] {
  if (chunkLines <= 0) {
    throw new Error('chunkArrayBy: chunkLines must be > 0');
  }
  if (lines.length === 0) {
    return [{ lines: [], cumulativeLineCount: 0, isLast: true }];
  }
  const out: GcodeChunk[] = [];
  let cumulative = 0;
  for (let i = 0; i < lines.length; i += chunkLines) {
    const slice = lines.slice(i, i + chunkLines);
    cumulative += slice.length;
    const isLast = i + chunkLines >= lines.length;
    out.push({
      lines: slice,
      cumulativeLineCount: cumulative,
      isLast,
    });
  }
  return out;
}

/**
 * Pure adapter: turn a synchronous `string[]` into an async iterable
 * of `GcodeChunk` of size `chunkLines`. Lets a legacy
 * `OutputStrategy.generate` result satisfy the streaming consumer
 * surface during the migration. The chunks are buffered in memory
 * (no streaming benefit) — that's the legacy reality and the whole
 * point of the eventual migration.
 */
export async function* fromArray(
  lines: readonly string[],
  options: GcodeGenerateOptions = {},
): AsyncGenerator<GcodeChunk, void, void> {
  const chunkLines = options.chunkLines ?? 1000;
  const chunks = chunkArrayBy(lines, chunkLines);
  for (const chunk of chunks) {
    if (options.signal?.aborted) return;
    yield chunk;
  }
}

/**
 * Drain an `AsyncIterable<GcodeChunk>` into a flat `string[]` plus a
 * line-count summary. Used by tests and the legacy ticket-emission
 * path that needs a flat array. Cancellation via `signal` returns
 * whatever was collected up to the abort point.
 */
export async function collectStreamingOutput(
  source: AsyncIterable<GcodeChunk>,
  signal?: AbortSignal,
): Promise<{ lines: readonly string[]; lineCount: number; sawLast: boolean }> {
  const acc: string[] = [];
  let sawLast = false;
  for await (const chunk of source) {
    if (signal?.aborted) break;
    for (const line of chunk.lines) acc.push(line);
    if (chunk.isLast) {
      sawLast = true;
      break;
    }
  }
  return { lines: acc, lineCount: acc.length, sawLast };
}

/**
 * Predicate: does this strategy advertise the streaming surface?
 * Useful while both legacy and streaming paths coexist; the future
 * `OutputStrategy` interface will absorb `StreamingOutputStrategy`
 * directly.
 */
export function isStreamingOutputStrategy(
  candidate: unknown,
): candidate is StreamingOutputStrategy {
  if (candidate === null || typeof candidate !== 'object') return false;
  const obj = candidate as { format?: unknown; generateGcode?: unknown };
  return typeof obj.format === 'string' && typeof obj.generateGcode === 'function';
}
