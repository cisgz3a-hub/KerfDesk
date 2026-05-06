/**
 * T2-70: previous autosave backup slot. Pre-T2-70 the autosave
 * record had a single key (`AUTOSAVE_RECORD_KEY` from T2-69). If
 * serialisation produced a corrupted record (bug, partial scene,
 * transient I/O issue), the next 30-second autosave tick replaced
 * the last-known-good with the bad copy and the user had no
 * fallback.
 *
 * Audit 4D Critical failure 6 + Required Priority 3.
 *
 * T2-70 ships the typed slot identifier + the rotation algorithm +
 * the corruption-resilient read path so when latest can't be parsed,
 * the recovery dialog (T1-71) can fall back to the previous slot.
 * Wiring the rotation into `autosavePersistence.persistAutosave`
 * + adding the "previous" slot to the recovery dialog is filed as
 * T2-70-followup.
 */

export type AutosaveSlot = 'current' | 'previous';

export const AUTOSAVE_CURRENT_KEY = 'laserforge_autosave_current';
export const AUTOSAVE_PREVIOUS_KEY = 'laserforge_autosave_previous';

export function keyForSlot(slot: AutosaveSlot): string {
  return slot === 'current' ? AUTOSAVE_CURRENT_KEY : AUTOSAVE_PREVIOUS_KEY;
}

/**
 * Storage adapter abstracted from the legacy `getStorage()` so
 * this module is testable without dragging in the IndexedDB /
 * Filesystem adapter.
 */
export interface AutosaveSlotStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Pure plan: given the current and incoming serialised records,
 * return the ordered set of writes the rotation needs to perform.
 * The plan is the test surface; the runner does the I/O.
 */
export interface RotationPlan {
  readonly writes: ReadonlyArray<{ key: string; value: string }>;
  readonly carriedPreviousFromCurrent: boolean;
}

export function planAutosaveRotation(opts: {
  existingCurrent: string | null;
  newSerialisedRecord: string;
}): RotationPlan {
  const writes: { key: string; value: string }[] = [];
  let carried = false;
  if (opts.existingCurrent != null) {
    writes.push({ key: AUTOSAVE_PREVIOUS_KEY, value: opts.existingCurrent });
    carried = true;
  }
  writes.push({ key: AUTOSAVE_CURRENT_KEY, value: opts.newSerialisedRecord });
  return { writes, carriedPreviousFromCurrent: carried };
}

/**
 * Execute the rotation. Reads existingCurrent, runs the planner,
 * writes in plan order. Errors during the previous-write are
 * captured but the current-write still runs (audit's "don't lose
 * the new data because the rotation failed" rule).
 */
export interface RotationResult {
  readonly carriedPreviousFromCurrent: boolean;
  readonly previousWriteSucceeded: boolean;
  readonly currentWriteSucceeded: boolean;
  readonly errors: readonly Error[];
}

export async function runAutosaveRotation(opts: {
  storage: AutosaveSlotStorage;
  newSerialisedRecord: string;
}): Promise<RotationResult> {
  const errors: Error[] = [];
  let existingCurrent: string | null = null;
  try {
    existingCurrent = await opts.storage.get(AUTOSAVE_CURRENT_KEY);
  } catch (e) {
    errors.push(e instanceof Error ? e : new Error(String(e)));
  }
  const plan = planAutosaveRotation({
    existingCurrent,
    newSerialisedRecord: opts.newSerialisedRecord,
  });
  let previousWriteSucceeded = !plan.carriedPreviousFromCurrent;
  let currentWriteSucceeded = false;
  for (const w of plan.writes) {
    try {
      await opts.storage.set(w.key, w.value);
      if (w.key === AUTOSAVE_PREVIOUS_KEY) previousWriteSucceeded = true;
      if (w.key === AUTOSAVE_CURRENT_KEY) currentWriteSucceeded = true;
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
    }
  }
  return {
    carriedPreviousFromCurrent: plan.carriedPreviousFromCurrent,
    previousWriteSucceeded,
    currentWriteSucceeded,
    errors,
  };
}

/**
 * Read result with corruption-aware fallback. `which` reports
 * which slot the returned record came from. Returns null only
 * when both slots are empty or unparseable.
 */
export interface SlotReadResult<R> {
  readonly record: R | null;
  readonly which: AutosaveSlot | null;
  readonly fellBackBecause: 'current-empty' | 'current-unparseable' | null;
}

/**
 * Corruption-resilient read. Try `current` first; on null OR
 * parse failure, try `previous`. Audit's headline test case.
 */
export async function readWithFallback<R>(opts: {
  storage: AutosaveSlotStorage;
  parse: (raw: string) => R;
}): Promise<SlotReadResult<R>> {
  const currentRaw = await opts.storage.get(AUTOSAVE_CURRENT_KEY);
  if (currentRaw == null) {
    const prev = await tryReadSlot('previous', opts);
    return {
      record: prev,
      which: prev != null ? 'previous' : null,
      fellBackBecause: 'current-empty',
    };
  }
  let parsed: R | null = null;
  try {
    parsed = opts.parse(currentRaw);
  } catch {
    parsed = null;
  }
  if (parsed != null) {
    return { record: parsed, which: 'current', fellBackBecause: null };
  }
  const prev = await tryReadSlot('previous', opts);
  return {
    record: prev,
    which: prev != null ? 'previous' : null,
    fellBackBecause: 'current-unparseable',
  };
}

async function tryReadSlot<R>(
  slot: AutosaveSlot,
  opts: { storage: AutosaveSlotStorage; parse: (raw: string) => R },
): Promise<R | null> {
  const raw = await opts.storage.get(keyForSlot(slot));
  if (raw == null) return null;
  try {
    return opts.parse(raw);
  } catch {
    return null;
  }
}

/** Clear both slots for new-project / discard-recovery flows. */
export async function clearBothSlots(storage: AutosaveSlotStorage): Promise<void> {
  await storage.remove(AUTOSAVE_CURRENT_KEY).catch(() => {});
  await storage.remove(AUTOSAVE_PREVIOUS_KEY).catch(() => {});
}

/**
 * UI-side helper: human-readable label for the recovery dialog.
 * Receives a parsed record + slot label.
 */
export function describeSlotForRecovery<R extends { timestamp: number; objectCount?: number; layerCount?: number }>(
  slot: AutosaveSlot,
  record: R,
): string {
  const labelPrefix = slot === 'current' ? 'Latest autosave' : 'Previous autosave';
  const ts = new Date(record.timestamp).toLocaleString();
  const counts = [];
  if (record.objectCount != null) counts.push(`${record.objectCount} object${record.objectCount === 1 ? '' : 's'}`);
  if (record.layerCount != null) counts.push(`${record.layerCount} layer${record.layerCount === 1 ? '' : 's'}`);
  const meta = counts.length > 0 ? ` (${counts.join(', ')})` : '';
  return `${labelPrefix}: ${ts}${meta}`;
}
