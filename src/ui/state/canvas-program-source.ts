import { isSendableGcodeLine } from '../../core/controllers/grbl';
import type { CanvasMotionPlan, LiveCanvasRun } from './canvas-motion-plan';

// Read-side source retention, intentionally outside serialized recovery plans.
// The key is the immutable started plan; losing the plan releases its source.
const sources = new WeakMap<CanvasMotionPlan, string>();
const queueMatches = new WeakMap<CanvasMotionPlan, WeakMap<ReadonlyArray<string>, boolean>>();
const runQueues = new WeakMap<
  ReadonlyArray<string>,
  { readonly plan: CanvasMotionPlan; readonly startedAtMs: number }
>();

export function registerCanvasProgramSource(plan: CanvasMotionPlan, gcode: string): void {
  sources.set(plan, gcode);
}

export function canvasProgramSource(plan: CanvasMotionPlan | null | undefined): string | null {
  return plan == null ? null : (sources.get(plan) ?? null);
}

/** A previous plan can outlive its streamer. Never attach it to a new queue. */
function canvasProgramMatchesQueue(plan: CanvasMotionPlan, queued: ReadonlyArray<string>): boolean {
  let cache = queueMatches.get(plan);
  const cached = cache?.get(queued);
  if (cached !== undefined) return cached;
  const source = canvasProgramSource(plan);
  let index = 0;
  let matches = source !== null;
  if (source !== null) {
    for (const raw of source.split('\n')) {
      const line = raw.trim();
      // The stream retains parenthesized comments; only semicolon-only and
      // blank lines are omitted. Match the exact stored wire line.
      if (!isSendableGcodeLine(line)) continue;
      if (queued[index] !== `${line}\n`) {
        matches = false;
        break;
      }
      index += 1;
    }
  }
  matches = matches && index === queued.length;
  if (cache === undefined) {
    cache = new WeakMap();
    queueMatches.set(plan, cache);
  }
  cache.set(queued, matches);
  return matches;
}

/** Records the read-only association at the already-authorized Start handoff. */
export function registerCanvasProgramRun(
  plan: CanvasMotionPlan,
  queued: ReadonlyArray<string>,
  startedAtMs: number,
  gcode?: string,
): void {
  // Production Start already holds the exact source used to create this queue.
  // Reuse that identity without allocating/splitting the whole program again.
  const matches =
    gcode === undefined
      ? canvasProgramMatchesQueue(plan, queued)
      : canvasProgramSource(plan) === gcode;
  if (matches) runQueues.set(queued, { plan, startedAtMs });
}

export function canvasProgramMatchesRunQueue(
  run: Pick<LiveCanvasRun, 'plan' | 'startedAtMs' | 'lifecycle'>,
  queued: ReadonlyArray<string> | null,
): boolean {
  // Completed history remains reviewable without a queue. An active run with
  // no associated streamer cannot claim to be following the controller.
  if (queued === null) return !['running', 'paused', 'tool-change'].includes(run.lifecycle);
  const bound = runQueues.get(queued);
  return bound?.plan === run.plan && bound.startedAtMs === run.startedAtMs;
}
