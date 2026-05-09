import type {
  SceneTransactionLogEvent,
  SceneTransactionReason,
} from '../ui/scene/SceneTransaction';

export type StateTransition =
  | { event: 'PROJECT_LOADED'; sceneHash: string | null; source: 'file' | 'autosave' | 'new'; at: number }
  | { event: 'SCENE_COMMITTED'; sceneHash: string | null; action: string; at: number }
  | { event: 'SCENE_PREVIEWED'; at: number }
  | { event: 'COMPILE_STARTED'; requestId: number; sceneHash: string; profileHash: string; at: number }
  | { event: 'COMPILE_READY'; requestId: number; durationMs: number; at: number }
  | { event: 'COMPILE_STALE'; reason: 'scene' | 'profile' | 'machine'; at: number }
  | { event: 'COMPILE_FAILED'; requestId: number; error: string; at: number }
  | { event: 'JOB_START_REQUESTED'; ticketId: string; at: number }
  | { event: 'JOB_RUNNING'; ticketId: string; at: number }
  | { event: 'JOB_PAUSED'; reason: 'user' | 'firmware' | 'door'; at: number }
  | { event: 'JOB_RESUMED'; at: number }
  | { event: 'JOB_STOPPING'; reason: 'user' | 'error'; at: number }
  | { event: 'JOB_COMPLETED'; ticketId: string; durationMs: number; at: number }
  | { event: 'JOB_FAILED'; ticketId: string; error: string; at: number }
  | { event: 'MACHINE_CONNECTED'; controllerType: string; at: number }
  | { event: 'MACHINE_DISCONNECTED'; reason: string; at: number }
  | { event: 'PROFILE_CHANGED'; from: string | null; to: string | null; at: number };

type TransitionListener = () => void;

/**
 * T3-68: bounded, in-memory transition log for developer/debug inspection.
 * It is intentionally persistence-free; support bundles and user-facing logs
 * are separate surfaces.
 */
export class TransitionLog {
  private readonly buffer: StateTransition[] = [];
  private readonly listeners = new Set<TransitionListener>();

  constructor(private readonly capacity = 500) {}

  emit(event: StateTransition): void {
    this.buffer.push(event);
    while (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
    this.notify();
  }

  getSnapshot(): StateTransition[] {
    return [...this.buffer];
  }

  clear(): void {
    if (this.buffer.length === 0) return;
    this.buffer.length = 0;
    this.notify();
  }

  subscribe(listener: TransitionListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try { listener(); } catch (err) { console.error('TransitionLog listener threw', err); }
    }
  }
}

function actionForReason(reason: SceneTransactionReason): string {
  switch (reason.kind) {
    case 'edit':
      return reason.action;
    case 'async-result':
      return `async:${reason.operation}`;
    case 'history':
      return `history:${reason.direction}`;
    case 'load':
      return `load:${reason.source}`;
    case 'preview':
      return 'preview';
  }
}

export function transitionFromSceneTransaction(event: SceneTransactionLogEvent): StateTransition {
  const { reason, ts } = event;
  if (reason.kind === 'load') {
    return {
      event: 'PROJECT_LOADED',
      sceneHash: null,
      source: reason.source,
      at: ts,
    };
  }
  if (reason.kind === 'preview') {
    return { event: 'SCENE_PREVIEWED', at: ts };
  }
  return {
    event: 'SCENE_COMMITTED',
    sceneHash: null,
    action: actionForReason(reason),
    at: ts,
  };
}

export const transitionLog = new TransitionLog();
