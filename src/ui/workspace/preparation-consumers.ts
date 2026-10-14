import type { Project } from '../../core/scene';
import type { PreparationProjection } from './preparation-worker-protocol';

type Consumer = { readonly projection: PreparationProjection };

/** Caller ownership is separate from the shared, identity-stable cache promise. */
export class PreparationConsumers {
  private readonly byProject = new WeakMap<Project, Map<string, Set<Consumer>>>();

  constructor(
    private readonly onUnowned: (project: Project, key: string) => void,
    private readonly cancelled: () => Error,
  ) {}

  hasPreview(project: Project, key: string): boolean {
    return [...(this.byProject.get(project)?.get(key) ?? [])].some(
      (consumer) => consumer.projection === 'preview',
    );
  }

  attach<T>(
    project: Project,
    key: string,
    projection: PreparationProjection,
    promise: Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let keys = this.byProject.get(project);
    if (keys === undefined) {
      keys = new Map();
      this.byProject.set(project, keys);
    }
    let owners = keys.get(key);
    if (owners === undefined) {
      owners = new Set();
      keys.set(key, owners);
    }
    const consumers = owners;
    const consumer: Consumer = { projection };
    consumers.add(consumer);
    let finished = false;
    const detach = (): boolean => {
      if (finished) return false;
      finished = true;
      signal?.removeEventListener('abort', abort);
      consumers.delete(consumer);
      if (consumers.size === 0 && keys.get(key) === consumers) keys.delete(key);
      return true;
    };
    let rejectCaller: ((error: Error) => void) | undefined;
    const abort = (): void => {
      if (!detach()) return;
      rejectCaller?.(this.cancelled());
      if (consumers.size === 0) this.onUnowned(project, key);
    };
    // Existing non-cancellable callers retain promise identity. Their token
    // lasts until completion and protects other consumers from cancellation.
    if (signal === undefined) {
      void promise.then(detach, detach);
      return promise;
    }
    const observed = new Promise<T>((resolve, reject) => {
      rejectCaller = reject;
      void promise.then(
        (value) => {
          if (detach()) resolve(value);
        },
        (error: unknown) => {
          if (detach()) reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    return observed;
  }
}
