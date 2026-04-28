/**
 * T2-76 — Single mutation transaction path.
 *
 * The unifying API for "the scene is changing, here's why."
 *
 * Background and context:
 *   Scene mutations across the app today touch some subset of: setScene,
 *   history.push/reset/undo/redo, sceneIsDirtyRef, setSelectedIds,
 *   setGcodeStale, hasFramedRef, preflightRef, setHistoryVersion. No
 *   single existing caller touches all of them; every caller is one
 *   forgotten line away from the "manual dirty flag" or "stale
 *   compile-cache after undo" defect class. T1-73 / T1-74 / T1-75 each
 *   fixed one specific case where someone forgot something.
 *
 *   commitSceneTransaction is the single entry point. Every mutation
 *   passes through it with a "why" tag (edit, preview, history, load,
 *   async-result), and the function does the right bookkeeping for
 *   that kind. New mutation sites can't forget anything because the
 *   function does it for them.
 *
 * This module is the pure function definition. App.tsx wires it up at
 * mount with real deps; tests use spy deps to verify the dispatch
 * logic without React.
 *
 * See `/mnt/user-data/outputs/T2-76-design.md` (in the session arc) for
 * the full design rationale, migration sequencing, and risk analysis.
 *
 * Step 1 of 8: this file is the function definition. Subsequent steps
 * wire it into App.tsx and migrate callers one at a time. Until those
 * land, this module exists but is not yet called from runtime — the
 * unit tests below are the only consumer.
 */

import type { Scene } from '../../core/scene/Scene';

/**
 * Why a scene mutation is happening. Determines history, dirty, and
 * invalidation defaults inside `commitSceneTransaction`.
 *
 * - `edit`: a normal user-initiated change. Pushes history, marks
 *   dirty, invalidates compile/frame/preflight.
 * - `preview`: a transient change for UI display only (e.g. mid-drag
 *   slider, hover preview). No history, no dirty, no invalidation.
 *   The eventual commit happens via a separate `edit` transaction.
 * - `history`: undo or redo. The history cursor already moved; we
 *   only setScene + invalidate. Selection is cleared today (pre-T2-79)
 *   unless `meta.selectionAfter` is provided.
 * - `load`: opening a file, restoring autosave, or "new project."
 *   Resets history to the loaded scene as the new baseline. Marks
 *   not-dirty (loaded state IS the saved state).
 * - `async-result`: the commit phase of a long-running async producer
 *   (trace, image import). Behaves like `edit` for the moment;
 *   `capturedRevisionId` is reserved for T2-77 to detect mid-async
 *   scene drift.
 */
export type SceneTransactionReason =
  | { kind: 'edit'; action: string }
  | { kind: 'preview' }
  | { kind: 'history'; direction: 'undo' | 'redo' }
  | { kind: 'load'; source: 'file' | 'autosave' | 'new' }
  | { kind: 'async-result'; operation: string; capturedRevisionId?: number };

/**
 * Per-call overrides. Most callers pass nothing.
 *
 * - `selectionAfter`: which object IDs should be selected after the
 *   transaction. Used by T2-79 (selection-restore on undo/redo) and by
 *   delete handlers (clear selection after delete). When omitted,
 *   selection is cleared on `history` reasons and unchanged otherwise
 *   (caller is responsible for managing selection in the latter case).
 * - `invalidatesCompile` / `invalidatesFrame` / `invalidatesPreflight`:
 *   override the per-reason defaults. Default true unless reason is
 *   `preview`. Useful when an edit doesn't actually require recompile
 *   (e.g. layer color change — visual only).
 */
export interface SceneTransactionMeta {
  selectionAfter?: ReadonlySet<string>;
  invalidatesCompile?: boolean;
  invalidatesFrame?: boolean;
  invalidatesPreflight?: boolean;
}

/**
 * The dependencies the function captures. App.tsx wires these at mount
 * time with real React state setters and refs. Tests use spy versions
 * to assert each dep is called the expected number of times for each
 * reason kind.
 *
 * `notifyDirty` takes a boolean rather than separate "mark dirty" /
 * "mark clean" calls so T2-88 (hash-derived dirty state) can swap the
 * implementation from `(d) => { sceneIsDirtyRef.current = d }` to a
 * no-op without touching this module or any caller.
 *
 * `transitionLog` is optional because T3-68 (the transition log) lands
 * later. Until then App.tsx omits it; after T3-68 it's wired in. The
 * function uses optional chaining so emission is a no-op when absent.
 */
export interface SceneTransactionDeps {
  setScene: (next: Scene) => void;
  history: {
    /**
     * Push a new history entry. The optional `meta` argument carries
     * action label and selection metadata (T2-78). Implementations may
     * accept just `(scene)` for backward compatibility; the dispatcher
     * always passes `meta` when called from a non-preview, non-history,
     * non-load reason.
     */
    push: (scene: Scene, meta?: HistoryEntryMetaForward) => void;
    /**
     * Replace history with a single entry as the new baseline.
     * Optional `meta` matches `push`. Used for `kind: 'load'` reasons.
     */
    reset: (scene: Scene, meta?: HistoryEntryMetaForward) => void;
  };
  setSelectedIds: (ids: Set<string>) => void;
  notifyDirty: (dirty: boolean) => void;
  /**
   * T2-78: read the current selection. Used by the dispatcher to
   * record `selectionBefore` on history entries. App.tsx wires this
   * to a ref so the read always reflects the latest selection state
   * (state-by-value capture would be stale across renders).
   */
  getSelection: () => ReadonlySet<string>;
  invalidate: {
    compile: () => void;
    frame: () => void;
    preflight: () => void;
  };
  transitionLog?: {
    emit: (event: SceneTransactionLogEvent) => void;
  };
}

/**
 * T2-78 metadata payload passed forward through `history.push` and
 * `history.reset`. Forward-declared here as a structural type to keep
 * SceneTransaction.ts independent of HistoryManager.ts (the actual
 * `HistoryEntryMeta` interface is exported from HistoryManager).
 *
 * Keep the two shapes in sync. The forward shape uses optional fields
 * so this module can construct a partial meta and let HistoryManager
 * apply its own defaults for anything omitted.
 */
export interface HistoryEntryMetaForward {
  action?: string;
  timestamp?: number;
  selectionBefore?: ReadonlySet<string>;
  selectionAfter?: ReadonlySet<string>;
}

/**
 * Shape of the event the transition log receives. Aligned with T3-68's
 * `StateTransition` union (see roadmap T3-68 spec). Defined here so
 * callers without T3-68 wired up can still satisfy the type.
 */
export interface SceneTransactionLogEvent {
  event: 'SCENE_TRANSACTION';
  reason: SceneTransactionReason;
  ts: number;
}

/**
 * Public type for the function. Useful for prop-typing dispatchers.
 */
export type CommitSceneTransaction = (
  next: Scene,
  reason: SceneTransactionReason,
  meta?: SceneTransactionMeta,
) => void;

/**
 * Build a `commitSceneTransaction` function bound to the given deps.
 *
 * The returned function is pure with respect to the deps — calling it
 * with the same arguments produces the same sequence of dep calls. No
 * internal state in the closure (history cursor, dirty flag, etc.) —
 * all state lives in the deps.
 *
 * Typical usage in App.tsx (step 2 of T2-76 migration):
 *
 *   const commitSceneTransaction = useMemo(
 *     () => makeCommitSceneTransaction({
 *       setScene,
 *       history: { push: s => historyRef.current.push(s),
 *                  reset: s => historyRef.current.reset(s) },
 *       setSelectedIds,
 *       notifyDirty: d => { sceneIsDirtyRef.current = d; },
 *       invalidate: {
 *         compile: () => setGcodeStale(true),
 *         frame: () => setHistoryVersion(v => v + 1),
 *         preflight: () => { preflightRef.current = null; },
 *       },
 *     }),
 *     [],
 *   );
 *
 * See `T2-76-design.md` for full migration plan.
 */
export function makeCommitSceneTransaction(
  deps: SceneTransactionDeps,
): CommitSceneTransaction {
  return (next, reason, meta) => {
    const isPreview = reason.kind === 'preview';
    const isLoad = reason.kind === 'load';
    const isHistory = reason.kind === 'history';

    // 1. Apply the scene first. Every reason kind does this.
    deps.setScene(next);

    // 2. History.
    //    - load: reset to make this the new baseline
    //    - preview: never touches history
    //    - history navigation: cursor already moved by historyRef.undo/redo
    //    - edit / async-result: push a new entry
    //
    // T2-78: when push or reset fires, capture metadata from the
    // reason + meta + current selection so HistoryEntry can record the
    // action label and selection-before/after for T2-79 consumers.
    if (isLoad || (!isPreview && !isHistory)) {
      const selectionBefore = deps.getSelection();
      const selectionAfter = meta?.selectionAfter ?? selectionBefore;
      const action = deriveActionLabel(reason);
      const entryMeta: HistoryEntryMetaForward = {
        action,
        // timestamp omitted; HistoryManager defaults to Date.now() at push time
        selectionBefore,
        selectionAfter,
      };
      if (isLoad) {
        deps.history.reset(next, entryMeta);
      } else {
        deps.history.push(next, entryMeta);
      }
    }

    // 3. Dirty state.
    //    - preview: no-op (no actual change to save)
    //    - load: explicitly clean (loaded scene == saved scene)
    //    - everything else: dirty
    if (isPreview) {
      // no-op
    } else if (isLoad) {
      deps.notifyDirty(false);
    } else {
      deps.notifyDirty(true);
    }

    // 4. Invalidation. Per-reason defaults; meta can override.
    //    Preview never invalidates. Everything else invalidates by
    //    default; specific edits can opt out via meta.
    const invalidateCompile = meta?.invalidatesCompile ?? !isPreview;
    const invalidateFrame = meta?.invalidatesFrame ?? !isPreview;
    const invalidatePreflight = meta?.invalidatesPreflight ?? !isPreview;
    if (invalidateCompile) deps.invalidate.compile();
    if (invalidateFrame) deps.invalidate.frame();
    if (invalidatePreflight) deps.invalidate.preflight();

    // 5. Selection.
    //    - meta.selectionAfter provided: apply it (T2-79 feeds this on
    //      undo/redo; delete handlers feed empty set).
    //    - history without meta: clear (pre-T2-79 behavior; safe but
    //      primitive — no stale IDs).
    //    - everything else without meta: leave selection alone
    //      (caller manages it, e.g. paste handlers select pasted IDs).
    if (meta?.selectionAfter) {
      deps.setSelectedIds(new Set(meta.selectionAfter));
    } else if (isHistory) {
      deps.setSelectedIds(new Set());
    }

    // 6. Transition log. T3-68 wires the emitter; until then optional.
    deps.transitionLog?.emit({
      event: 'SCENE_TRANSACTION',
      reason,
      ts: Date.now(),
    });
  };
}

/**
 * T2-78: derive a kebab-case action label from the dispatch reason.
 * Used to tag history entries so T2-79 (selection restore), T2-80
 * (history coalescing), and T3-68 (transition log) can consume a
 * consistent label without re-deriving from the reason union.
 *
 * Only called for reasons that produce a history entry (load, edit,
 * async-result). preview and history reasons skip the entry build
 * entirely.
 */
function deriveActionLabel(reason: SceneTransactionReason): string {
  switch (reason.kind) {
    case 'edit':
      return reason.action;
    case 'load':
      return `load:${reason.source}`;
    case 'async-result':
      return `async:${reason.operation}`;
    case 'preview':
    case 'history':
      // Should never reach here - these reasons don't push or reset
      // history. Returning a sentinel rather than throwing preserves
      // robustness if a future reason is added without updating this
      // switch.
      return 'unknown';
  }
}
