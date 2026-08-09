// Autosave interval loop — the background tick that keeps the recovery slot
// current while the project has no file of record yet.
//
// Split out of autosave.ts, which owns the slot's storage schema: the schema
// and the timer that feeds it are two responsibilities, and neither file has
// room for the other under the 250-line soft limit.
//
// The tick is deliberately cheap to no-op. `dirty` does NOT mean "changed since
// the last autosave" — it means "no .lf2 file of record yet", and stays true
// from the first edit until the next manual save. Without the memo below, a
// project nobody had touched paid a full autosave on every tick forever:
// serializeProject, a validate-parse of that string, a re-stringify of it
// inside the record, then a synchronous localStorage.setItem — each pass
// walking the whole project JSON, which on an image-heavy scene is hundreds of
// megabytes. That is the recurring UI stall this module exists to avoid.

import type { Project } from '../../core/scene';
import { AUTOSAVE_INTERVAL_MS, autosaveSlotGeneration, writeAutosave } from './autosave';
import type { AutosaveWriteFailure, AutosaveWriteResult } from './autosave';

type AutosaveLoopWriteResult = AutosaveWriteResult | { readonly kind: 'superseded' };
type AutosaveLoopWriter = (
  project: Project,
) => AutosaveLoopWriteResult | Promise<AutosaveLoopWriteResult>;

export type AutosaveSnapshotFn = () => {
  readonly project: Project;
  readonly dirty: boolean;
  readonly isStreaming: boolean;
};

// What the last attempted tick did, to which Project value, and against which
// state of the slot. Store slices replace `project` with a new value on every
// edit and never mutate one in place (undo/redo swap whole Project objects), so
// an unchanged reference proves the serialized bytes are unchanged too — for
// free, and without retaining a second copy of a multi-hundred-megabyte JSON
// string for the whole session the way a byte comparison would. The test is
// one-sided on purpose: a content-equal but freshly built Project just takes
// the slow path and writes again, so the memo can never skip a write the slot
// really needs. `generation` is the other half of that guarantee — see below.
type AutosaveTickMemo =
  | { readonly kind: 'no-attempt' }
  | { readonly kind: 'written'; readonly project: Project; readonly generation: number }
  | { readonly kind: 'quota-exceeded'; readonly project: Project; readonly generation: number };

// Either the slot already holds exactly this project, or this exact project has
// already been refused for size and no repeat of it can ever fit — so the work
// is pure waste both ways. Any edit changes the reference and releases both
// cases, which is what lets a project the operator shrinks save on the next
// tick.
//
// Both premises are about the SLOT, not just the project, and the loop is not
// the only writer: handleSaveProject empties the slot on every successful
// manual save. An undo can then hand back the very Project object an earlier
// tick wrote, so reference equality alone would report "already saved" about an
// empty slot forever and silently disarm crash recovery. Comparing the slot
// generation the memo was taken at releases both cases whenever anything clears
// the slot — and a clear also frees the space a quota refusal was about, so
// retrying then is worth a tick. This skips background work only; the
// beforeunload write and manual save are untouched and never consult the memo.
function isTickRedundant(memo: AutosaveTickMemo, project: Project, generation: number): boolean {
  return memo.kind !== 'no-attempt' && memo.project === project && memo.generation === generation;
}

// Only 'ok' and 'quota' are remembered. A 'storage-error' can be transient (a
// momentarily unavailable storage area) and 'invalid-project' resolves as soon
// as the operator edits, so both keep retrying rather than latching off.
function nextTickMemo(
  previous: AutosaveTickMemo,
  attempt: { readonly project: Project; readonly generation: number },
  result: AutosaveWriteResult,
): AutosaveTickMemo {
  const { project, generation } = attempt;
  if (result.kind === 'ok') return { kind: 'written', project, generation };
  if (result.kind === 'failed' && result.reason === 'quota') {
    return { kind: 'quota-exceeded', project, generation };
  }
  return previous;
}

// Starts a setInterval-driven autosave loop. Returns the stop function;
// callers (the React hook) clear on unmount. The interval is configurable
// for tests; production wiring passes AUTOSAVE_INTERVAL_MS.
export function startAutosaveLoop(
  getSnapshot: AutosaveSnapshotFn,
  intervalMs: number = AUTOSAVE_INTERVAL_MS,
  onWriteFailure?: (failure: AutosaveWriteFailure) => void,
  writer: AutosaveLoopWriter = writeAutosave,
): () => void {
  let memo: AutosaveTickMemo = { kind: 'no-attempt' };
  let inFlight = false;
  const handle = setInterval(() => {
    const snap = getSnapshot();
    if (!snap.dirty) return;
    if (snap.isStreaming) return;
    // Read once per tick so the redundancy check and the memo it produces are
    // both stamped with the same slot generation.
    const generation = autosaveSlotGeneration();
    if (isTickRedundant(memo, snap.project, generation)) return;
    if (inFlight) return;
    inFlight = true;
    const finish = (result: AutosaveLoopWriteResult): void => {
      if (result.kind !== 'superseded') {
        memo = nextTickMemo(memo, { project: snap.project, generation }, result);
        if (result.kind !== 'ok') onWriteFailure?.(result);
      }
      inFlight = false;
    };
    try {
      const result = writer(snap.project);
      if (isPromiseLike(result)) {
        void result.then(finish, (error: unknown) =>
          finish({ kind: 'failed', reason: 'storage-error', error }),
        );
      } else {
        finish(result);
      }
    } catch (error) {
      finish({ kind: 'failed', reason: 'storage-error', error });
    }
  }, intervalMs);
  return () => clearInterval(handle);
}

function isPromiseLike(
  value: AutosaveLoopWriteResult | Promise<AutosaveLoopWriteResult>,
): value is Promise<AutosaveLoopWriteResult> {
  return typeof (value as Promise<AutosaveLoopWriteResult>).then === 'function';
}
