/**
 * T2-112: event-window retention strategy for JobLog compaction.
 * Pre-T2-112 `compactJobLogForStorage` at `src/core/job/JobLog.ts:69`
 * kept the first 25 + last 25 raw entries when total > 200. For a
 * long job that fails halfway, the most diagnostic raw traffic is
 * RIGHT BEFORE the failure — somewhere in the middle of the entries
 * array. The first-25/last-25 truncation discards exactly that
 * window.
 *
 * Audit 5C Critical 5 + Required Priority 6. T2-112 ships the new
 * compaction algorithm + a `_truncated` flag the consumer can read
 * to know "this log was compacted". Wiring this into
 * `compactJobLogForStorage` is filed as T2-112-followup.
 *
 * The algorithm:
 *   1. Keep ALL non-raw entries (milestone / error / warning / info).
 *   2. For each event, keep `windowBefore` raw entries before and
 *      `windowAfter` raw entries after.
 *   3. Always keep the first `headKeep` and last `tailKeep` entries
 *      (job start + job end context).
 *   4. The compacted set is the UNION of (1)+(2)+(3).
 */

export type JobLogEntryType = 'sent' | 'received' | 'milestone' | 'error' | 'warning' | 'info';

/**
 * Minimal shape the compactor needs from a JobLog entry. The full
 * shape lives at `src/core/job/JobLog.ts`; T2-112 declares the
 * subset so this module compiles independently.
 */
export interface JobLogEntryLike {
  type: JobLogEntryType;
  timestamp?: number;
  message?: string;
  [k: string]: unknown;
}

const EVENT_TYPES = new Set<JobLogEntryType>(['milestone', 'error', 'warning', 'info']);

export function isEventEntry(entry: JobLogEntryLike): boolean {
  return EVENT_TYPES.has(entry.type);
}

export interface EventWindowOptions {
  /**
   * Compact only when entries.length > this. Default 200 (matches
   * the pre-T2-112 trigger).
   */
  triggerThreshold: number;
  /** Raw entries kept BEFORE each event. Audit recommendation: 100. */
  windowBefore: number;
  /** Raw entries kept AFTER each event. Audit recommendation: 50. */
  windowAfter: number;
  /** Always-kept first N raw entries (job-start context). Audit: 50. */
  headKeep: number;
  /** Always-kept last N raw entries (near-job-end context). Audit: 200. */
  tailKeep: number;
}

export const DEFAULT_EVENT_WINDOW_OPTIONS: EventWindowOptions = {
  triggerThreshold: 200,
  windowBefore: 100,
  windowAfter: 50,
  headKeep: 50,
  tailKeep: 200,
};

export interface CompactionResult {
  entries: JobLogEntryLike[];
  /** True when the input was compacted (entries.length differs from output). */
  truncated: boolean;
  /** Number of entries dropped. */
  droppedCount: number;
  /** Indices kept (sorted ascending). */
  keptIndices: number[];
  /** Number of event entries that were preserved. */
  eventCount: number;
}

/**
 * Compact a list of entries via event-window retention. Returns the
 * compacted array + the truncated flag + diagnostics. The original
 * input array is NOT mutated.
 */
export function compactWithEventWindow(
  entries: ReadonlyArray<JobLogEntryLike>,
  options: Partial<EventWindowOptions> = {},
): CompactionResult {
  const opts: EventWindowOptions = { ...DEFAULT_EVENT_WINDOW_OPTIONS, ...options };

  if (entries.length <= opts.triggerThreshold) {
    return {
      entries: [...entries],
      truncated: false,
      droppedCount: 0,
      keptIndices: entries.map((_, i) => i),
      eventCount: entries.filter(isEventEntry).length,
    };
  }

  const keep = new Set<number>();
  let eventCount = 0;

  // 1. All event entries plus their windows
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!isEventEntry(e)) continue;
    eventCount += 1;
    keep.add(i);
    const start = Math.max(0, i - opts.windowBefore);
    const end = Math.min(entries.length, i + opts.windowAfter + 1);
    for (let j = start; j < end; j++) keep.add(j);
  }

  // 2. Head context
  for (let i = 0; i < Math.min(opts.headKeep, entries.length); i++) {
    keep.add(i);
  }

  // 3. Tail context
  const tailStart = Math.max(0, entries.length - opts.tailKeep);
  for (let i = tailStart; i < entries.length; i++) {
    keep.add(i);
  }

  const sortedIndices = [...keep].sort((a, b) => a - b);
  const compacted = sortedIndices.map((i) => entries[i]);
  const dropped = entries.length - compacted.length;

  return {
    entries: compacted,
    truncated: dropped > 0,
    droppedCount: dropped,
    keptIndices: sortedIndices,
    eventCount,
  };
}

/**
 * Convenience: just the compacted entries array. Used by call sites
 * that don't need the diagnostics object.
 */
export function compactEntries(
  entries: ReadonlyArray<JobLogEntryLike>,
  options: Partial<EventWindowOptions> = {},
): JobLogEntryLike[] {
  return compactWithEventWindow(entries, options).entries;
}

/**
 * Diagnostic: estimate how many bytes would be saved by compaction
 * vs. the original entries. Used by T2-116 storage health to
 * predict whether enabling compaction would help / surface a
 * "compact now" affordance.
 */
export function estimateCompactionSavings(
  entries: ReadonlyArray<JobLogEntryLike>,
  options: Partial<EventWindowOptions> = {},
): { droppedCount: number; estimatedBytesSaved: number } {
  const result = compactWithEventWindow(entries, options);
  // Rough: assume each entry serialises to ~80 bytes JSON.
  return {
    droppedCount: result.droppedCount,
    estimatedBytesSaved: result.droppedCount * 80,
  };
}
