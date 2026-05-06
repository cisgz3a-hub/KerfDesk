/**
 * T2-84: system-level `RuntimeState` meta-container. Pre-T2-84
 * runtime state was scattered across `App.tsx` (refs and useStates),
 * `MachineService`, `ExecutionCoordinator`, `useCompileManager`,
 * `ConnectionPanelMain`, profile storage, etc. — no single
 * container held them. Cross-cutting consumers (debug overlay,
 * transition log, error reporter) had to wire through 8 different
 * hooks/refs to see the same state.
 *
 * Audit 4F Critical failure 1 + Required Priority 1.
 *
 * T2-84 ships the meta-shape that composes the constituent state
 * machines already shipped in this batch (T2-51 CompiledJobState,
 * T2-44 SafetyState, T2-53 JobPhase, T2-86 FrameState, T2-87
 * RecoveryState) plus minimal ProjectState/EditorState/PersistenceState
 * shapes for completeness. Component migration to read via the
 * store is filed as T2-84-followup.
 */

import type { CompiledJobState } from '../app/CompiledJobState';
import type { SafetyState } from '../app/SafetyStateMachine';
import type { JobPhase } from '../app/JobSession';
import type { RecoveryState } from './RecoveryState';

/**
 * Editor / project / persistence shapes are described here so the
 * meta-container compiles independently. These mirror the audit's
 * field list; the per-piece tickets that own them remain authoritative.
 */
export interface ProjectState {
  readonly sceneHash: string | null;
  readonly profileId: string | null;
  readonly profileHash: string | null;
  readonly objectCount: number;
  readonly layerCount: number;
}

export interface EditorState {
  readonly selectionCount: number;
  readonly hasOpenDialog: boolean;
  readonly viewportZoom: number;
}

export type PersistenceStatus =
  | 'clean'
  | 'dirty'
  | 'saving'
  | 'save-failed';

export interface PersistenceState {
  readonly status: PersistenceStatus;
  readonly lastSavedAt: number | null;
  readonly lastSavedHash: string | null;
  readonly autosaveEnabled: boolean;
}

export interface FrameStateLike {
  readonly status: 'unframed' | 'framed' | 'framing' | 'failed';
  readonly framedAt: number | null;
}

/**
 * The meta-container. Each slot is a state already owned by its
 * own state-machine ticket — RuntimeState does not duplicate
 * transition logic; it only holds the snapshot.
 */
export interface RuntimeState {
  readonly project: ProjectState;
  readonly editor: EditorState;
  readonly compile: CompiledJobState;
  readonly frame: FrameStateLike;
  readonly machine: SafetyState;
  readonly job: JobPhase;
  readonly recovery: RecoveryState;
  readonly persistence: PersistenceState;
}

/** Sentinel for when no project is loaded. */
export const initialProjectState: ProjectState = {
  sceneHash: null,
  profileId: null,
  profileHash: null,
  objectCount: 0,
  layerCount: 0,
};

export const initialEditorState: EditorState = {
  selectionCount: 0,
  hasOpenDialog: false,
  viewportZoom: 1,
};

export const initialPersistenceState: PersistenceState = {
  status: 'clean',
  lastSavedAt: null,
  lastSavedHash: null,
  autosaveEnabled: true,
};

export const initialFrameState: FrameStateLike = {
  status: 'unframed',
  framedAt: null,
};

/**
 * Build a baseline RuntimeState. The compile/machine/job/recovery
 * slots take their initial values from their owning ticket's
 * initial-state export; the caller passes them in to avoid a
 * cyclic import surface.
 */
export function buildInitialRuntimeState(opts: {
  compile: CompiledJobState;
  machine: SafetyState;
  job: JobPhase;
  recovery: RecoveryState;
}): RuntimeState {
  return {
    project: initialProjectState,
    editor: initialEditorState,
    compile: opts.compile,
    frame: initialFrameState,
    machine: opts.machine,
    job: opts.job,
    recovery: opts.recovery,
    persistence: initialPersistenceState,
  };
}

/**
 * Subscribable single store. `useSyncExternalStore`-shaped: caller
 * supplies a selector, gets back a stable snapshot per key. Only
 * notifies when the key's identity actually changed (referential
 * compare) so unrelated React subtrees don't re-render.
 */
export class RuntimeStateStore {
  private _state: RuntimeState;
  private readonly _listeners = new Set<() => void>();

  constructor(initial: RuntimeState) {
    this._state = initial;
  }

  getSnapshot(): RuntimeState {
    return this._state;
  }

  /** Replace one slot. No-op when the new value === existing. */
  update<K extends keyof RuntimeState>(key: K, next: RuntimeState[K]): boolean {
    if (this._state[key] === next) return false;
    this._state = { ...this._state, [key]: next };
    this._notify();
    return true;
  }

  /** Replace several slots in a single tick (batched notification). */
  updateMany(patch: Partial<RuntimeState>): boolean {
    let changed = false;
    const next: { [K in keyof RuntimeState]?: RuntimeState[K] } = {};
    for (const key of Object.keys(patch) as (keyof RuntimeState)[]) {
      const v = patch[key];
      if (v !== undefined && v !== this._state[key]) {
        (next as Record<string, unknown>)[key] = v;
        changed = true;
      }
    }
    if (!changed) return false;
    this._state = { ...this._state, ...next };
    this._notify();
    return true;
  }

  subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  /** Listener count — diagnostic. */
  listenerCount(): number {
    return this._listeners.size;
  }

  private _notify(): void {
    for (const l of this._listeners) {
      try { l(); } catch (e) { console.error('RuntimeStateStore listener threw', e); }
    }
  }
}

/**
 * Cross-cutting derivations — used by the audit's "transition log"
 * + "debug overlay" consumers.
 */

export type RuntimeReadiness =
  | 'no-project'
  | 'project-loaded'
  | 'compile-ready'
  | 'frame-ready'
  | 'job-ready';

/**
 * Pure derivation: where in the readiness pipeline is the user?
 * Audit's headline use case.
 */
export function readinessFor(state: RuntimeState): RuntimeReadiness {
  if (state.project.sceneHash == null) return 'no-project';
  if (state.compile.status !== 'ready') return 'project-loaded';
  if (state.frame.status !== 'framed') return 'compile-ready';
  // job-ready requires recovery clean — audit's safety + readiness composition
  if (state.recovery.status !== 'none') return 'frame-ready';
  return 'job-ready';
}

/** Predicate the toolbar Start button consults. */
export function canStartJob(state: RuntimeState): boolean {
  return readinessFor(state) === 'job-ready';
}
