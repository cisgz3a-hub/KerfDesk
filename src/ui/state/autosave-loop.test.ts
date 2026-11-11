import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, type Project } from '../../core/scene';
import { clearAutosave, readAutosave } from './autosave';
import { startAutosaveLoop } from './autosave-loop';

const TICK_MS = 100;
// Enough ticks that a per-tick rewrite is unmistakable in the setItem count.
const IDLE_TICKS = 5;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

function spyOnSetItem(): ReturnType<typeof vi.spyOn<Storage, 'setItem'>> {
  return vi.spyOn(Storage.prototype, 'setItem');
}

function failEverySetItemWithQuota(): ReturnType<typeof vi.spyOn<Storage, 'setItem'>> {
  return spyOnSetItem().mockImplementation(() => {
    throw new DOMException('storage full', 'QuotaExceededError');
  });
}

function editedProject(notes: string): Project {
  return { ...createProject(), notes };
}

describe('startAutosaveLoop', () => {
  it('writes when dirty and not streaming, on the interval tick', () => {
    const project = createProject();
    const stop = startAutosaveLoop(() => ({ project, dirty: true, isStreaming: false }), TICK_MS);
    expect(readAutosave()).toBeNull(); // no tick yet
    vi.advanceTimersByTime(TICK_MS);
    expect(readAutosave()).not.toBeNull();
    stop();
  });

  it('reports write failures so the UI can warn that recovery is unavailable', () => {
    failEverySetItemWithQuota();
    const project = createProject();
    const onWriteFailure = vi.fn();
    const stop = startAutosaveLoop(
      () => ({ project, dirty: true, isStreaming: false }),
      TICK_MS,
      onWriteFailure,
    );

    vi.advanceTimersByTime(TICK_MS);

    expect(onWriteFailure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'failed', reason: 'quota' }),
    );
    stop();
  });

  it('skips writes when the project is not dirty', () => {
    const project = createProject();
    const stop = startAutosaveLoop(() => ({ project, dirty: false, isStreaming: false }), TICK_MS);
    vi.advanceTimersByTime(TICK_MS * IDLE_TICKS);
    expect(readAutosave()).toBeNull();
    stop();
  });

  it('skips writes during a job unless the caller vouches for its writer', () => {
    const project = createProject();
    const stop = startAutosaveLoop(() => ({ project, dirty: true, isStreaming: true }), TICK_MS);
    vi.advanceTimersByTime(TICK_MS * IDLE_TICKS);
    expect(readAutosave()).toBeNull();
    stop();
  });

  // ADR-305 Amendment 1 (annoyance audit A4-P2-1): a job no longer switches
  // autosave off. The caller's gate decides, project by project.
  describe('while a job streams', () => {
    it('writes on the interval when the gate lets the project through', async () => {
      const project = editedProject('drawn while the job ran');
      const writer = vi.fn(async () => ({ kind: 'ok', savedAt: 1, storageKey: 'slot' }) as const);
      const waiting: boolean[] = [];
      const stop = startAutosaveLoop(
        () => ({ project, dirty: true, isStreaming: true }),
        TICK_MS,
        undefined,
        writer,
        { writeDuringJob: () => true, onWaitingForJob: (held) => waiting.push(held) },
      );

      await vi.advanceTimersByTimeAsync(TICK_MS);

      expect(writer).toHaveBeenCalledTimes(1);
      expect(writer).toHaveBeenCalledWith(project);
      expect(waiting).toEqual([false]);
      stop();
    });

    it('holds a project the gate refuses, says so, and writes it when the job ends', async () => {
      const project = editedProject('too large for a job');
      const writer = vi.fn(async () => ({ kind: 'ok', savedAt: 1, storageKey: 'slot' }) as const);
      const waiting: boolean[] = [];
      const asked: Project[] = [];
      let isStreaming = true;
      const stop = startAutosaveLoop(
        () => ({ project, dirty: true, isStreaming }),
        TICK_MS,
        undefined,
        writer,
        {
          writeDuringJob: (candidate) => {
            asked.push(candidate);
            return false;
          },
          onWaitingForJob: (held) => waiting.push(held),
        },
      );

      await vi.advanceTimersByTimeAsync(TICK_MS * 2);
      expect(writer).not.toHaveBeenCalled();
      expect(asked).toEqual([project, project]);
      expect(waiting).toEqual([true, true]);

      isStreaming = false;
      await vi.advanceTimersByTimeAsync(TICK_MS);
      expect(writer).toHaveBeenCalledTimes(1);
      expect(waiting).toEqual([true, true, false]);
      stop();
    });

    it('asks the gate again after every edit', async () => {
      let project = editedProject('small');
      const writer = vi.fn(async () => ({ kind: 'ok', savedAt: 1, storageKey: 'slot' }) as const);
      const allowed = new Set<Project>([project]);
      const stop = startAutosaveLoop(
        () => ({ project, dirty: true, isStreaming: true }),
        TICK_MS,
        undefined,
        writer,
        { writeDuringJob: (candidate) => allowed.has(candidate) },
      );

      await vi.advanceTimersByTimeAsync(TICK_MS);
      expect(writer).toHaveBeenCalledTimes(1);

      project = editedProject('grew past the limit');
      await vi.advanceTimersByTimeAsync(TICK_MS);
      expect(writer).toHaveBeenCalledTimes(1);

      allowed.add(project);
      await vi.advanceTimersByTimeAsync(TICK_MS);
      expect(writer).toHaveBeenCalledTimes(2);
      stop();
    });

    it('says nothing is waiting when the slot already holds the project, or nothing is unsaved', async () => {
      const project = editedProject('saved before the job');
      const writer = vi.fn(async () => ({ kind: 'ok', savedAt: 1, storageKey: 'slot' }) as const);
      const waiting: boolean[] = [];
      const gate = vi.fn(() => false);
      let snapshot = { project, dirty: true, isStreaming: false };
      const stop = startAutosaveLoop(() => snapshot, TICK_MS, undefined, writer, {
        writeDuringJob: gate,
        onWaitingForJob: (held) => waiting.push(held),
      });

      // Written before the job starts: the job then holds nothing back.
      await vi.advanceTimersByTimeAsync(TICK_MS);
      snapshot = { project, dirty: true, isStreaming: true };
      await vi.advanceTimersByTimeAsync(TICK_MS);
      // A manual save during the job leaves nothing to write.
      snapshot = { project: editedProject('saved to a file'), dirty: false, isStreaming: true };
      await vi.advanceTimersByTimeAsync(TICK_MS);

      expect(writer).toHaveBeenCalledTimes(1);
      expect(gate).not.toHaveBeenCalled();
      expect(waiting).toEqual([false, false, false]);
      stop();
    });

    it('never starts the synchronous default writer during a job', () => {
      const setItem = spyOnSetItem();
      const project = editedProject('default writer');
      // No writer and no gate: the localStorage writer serialises on this thread.
      const stop = startAutosaveLoop(() => ({ project, dirty: true, isStreaming: true }), TICK_MS);
      vi.advanceTimersByTime(TICK_MS * IDLE_TICKS);
      expect(setItem).not.toHaveBeenCalled();
      stop();
    });
  });

  it('stop function cancels future writes', () => {
    let dirty = true;
    const project = createProject();
    const stop = startAutosaveLoop(() => ({ project, dirty, isStreaming: false }), TICK_MS);
    vi.advanceTimersByTime(TICK_MS);
    expect(readAutosave()).not.toBeNull();
    clearAutosave();
    stop();
    // Even with dirty true, no more writes after stop.
    dirty = true;
    vi.advanceTimersByTime(TICK_MS * 10);
    expect(readAutosave()).toBeNull();
  });
});

// `dirty` means "no .lf2 file of record yet", not "changed since the last
// autosave" — it stays true from the first edit until the next manual save.
// The loop therefore used to pay a full autosave (serialize + validate-parse +
// record re-stringify + synchronous setItem, each walking the whole project
// JSON) on EVERY tick of a project nobody had touched.
describe('startAutosaveLoop skips ticks that would rewrite the same project', () => {
  it('does not touch storage again while the project value is unchanged', () => {
    const project = createProject();
    const setItem = spyOnSetItem();
    const stop = startAutosaveLoop(() => ({ project, dirty: true, isStreaming: false }), TICK_MS);

    vi.advanceTimersByTime(TICK_MS);
    const writesAfterFirstTick = setItem.mock.calls.length;
    expect(writesAfterFirstTick).toBeGreaterThan(0);
    vi.advanceTimersByTime(TICK_MS * IDLE_TICKS);

    expect(setItem.mock.calls.length).toBe(writesAfterFirstTick);
    stop();
  });

  it('writes again as soon as the project changes', () => {
    let project = editedProject('first');
    const stop = startAutosaveLoop(() => ({ project, dirty: true, isStreaming: false }), TICK_MS);

    vi.advanceTimersByTime(TICK_MS);
    expect(readAutosave()?.project.notes).toBe('first');
    project = editedProject('second');
    vi.advanceTimersByTime(TICK_MS);

    expect(readAutosave()?.project.notes).toBe('second');
    stop();
  });
});

// The skip-if-unchanged memo remembers a Project value, but the slot it is
// reasoning about can be emptied behind the loop's back: handleSaveProject
// calls clearAutosave() after every successful manual save. Undo then restores
// the very Project object an earlier tick wrote, so a reference-only memo
// concludes "already saved" while the slot is in fact empty — silently
// disarming the 30 s crash-recovery net for the rest of the session.
describe('startAutosaveLoop re-arms the slot after it is cleared', () => {
  it('writes again when undo restores the same project a manual save cleared', () => {
    const beforeEdit = editedProject('before edit');
    const afterEdit = editedProject('after edit');
    let snapshot = { project: beforeEdit, dirty: true, isStreaming: false };
    const stop = startAutosaveLoop(() => snapshot, TICK_MS);

    // (1) a tick autosaves the project, memoizing that exact value.
    vi.advanceTimersByTime(TICK_MS);
    expect(readAutosave()?.project.notes).toBe('before edit');

    // (2) the operator edits, then (3) manually saves inside the same window:
    // the manual save empties the slot and clears dirty.
    snapshot = { project: afterEdit, dirty: true, isStreaming: false };
    clearAutosave();
    snapshot = { project: afterEdit, dirty: false, isStreaming: false };
    expect(readAutosave()).toBeNull();

    // (4) undo restores the SAME Project reference the tick in (1) wrote.
    snapshot = { project: beforeEdit, dirty: true, isStreaming: false };

    // (5) the next tick must re-arm the empty slot.
    vi.advanceTimersByTime(TICK_MS);
    expect(readAutosave()?.project.notes).toBe('before edit');

    // …and having re-armed it, the memo must go back to skipping idle ticks.
    const setItem = spyOnSetItem();
    vi.advanceTimersByTime(TICK_MS * IDLE_TICKS);
    expect(setItem.mock.calls.length).toBe(0);
    stop();
  });
});

// A project past the ~5 MB localStorage cap fails with 'quota' on every tick.
// Retrying the identical project can never succeed, so the retry bought nothing
// and cost a full serialize + validate + setItem attempt every 30 s forever.
// The operator still gets the warning: the failure is reported on the attempt
// that actually failed, and createAutosaveFailureReporter warns once per session.
describe('startAutosaveLoop backs off after a quota failure', () => {
  it('stops retrying the identical project once it does not fit', () => {
    const setItem = failEverySetItemWithQuota();
    const project = createProject();
    const onWriteFailure = vi.fn();
    const stop = startAutosaveLoop(
      () => ({ project, dirty: true, isStreaming: false }),
      TICK_MS,
      onWriteFailure,
    );

    vi.advanceTimersByTime(TICK_MS);
    const attemptsAfterFirstTick = setItem.mock.calls.length;
    expect(attemptsAfterFirstTick).toBeGreaterThan(0);
    vi.advanceTimersByTime(TICK_MS * IDLE_TICKS);

    expect(setItem.mock.calls.length).toBe(attemptsAfterFirstTick);
    expect(onWriteFailure).toHaveBeenCalledTimes(1);
    stop();
  });

  it('retries once the project changes, so a shrunk project still recovers', () => {
    const setItem = failEverySetItemWithQuota();
    let project = editedProject('too big');
    const stop = startAutosaveLoop(() => ({ project, dirty: true, isStreaming: false }), TICK_MS);

    vi.advanceTimersByTime(TICK_MS);
    expect(readAutosave()).toBeNull();
    setItem.mockRestore();
    project = editedProject('shrunk');
    vi.advanceTimersByTime(TICK_MS);

    expect(readAutosave()?.project.notes).toBe('shrunk');
    stop();
  });
});

describe('startAutosaveLoop async writer serialization', () => {
  it('never overlaps interval writes and resumes after completion', async () => {
    let finishFirst = (_result: { readonly kind: 'ok' }): void => undefined;
    const first = new Promise<{ readonly kind: 'ok' }>((resolve) => {
      finishFirst = resolve;
    });
    const writer = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue({ kind: 'ok' });
    let project = createProject();
    const stop = startAutosaveLoop(
      () => ({ project, dirty: true, isStreaming: false }),
      TICK_MS,
      undefined,
      writer,
    );

    vi.advanceTimersByTime(TICK_MS * IDLE_TICKS);
    expect(writer).toHaveBeenCalledOnce();

    finishFirst({ kind: 'ok' });
    await first;
    await Promise.resolve();
    project = { ...project, notes: 'edited after first write' };
    vi.advanceTimersByTime(TICK_MS);
    expect(writer).toHaveBeenCalledTimes(2);
    stop();
  });
});
