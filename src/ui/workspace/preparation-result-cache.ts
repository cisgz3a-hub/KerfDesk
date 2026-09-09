import type { Project } from '../../core/scene';
import type { LargeJobEstimate, LargeJobPreparation } from './large-job-preparation';

export type PreparationCacheEntry =
  | { readonly projection: 'preview'; readonly promise: Promise<LargeJobPreparation> }
  | { readonly projection: 'estimate'; readonly promise: Promise<LargeJobEstimate> };

type SettledEntry = {
  readonly project: Project;
  readonly key: string;
  readonly entry: PreparationCacheEntry;
};

/** One capability per exact project/options, with a global settled-result bound. */
export class PreparationResultCache {
  private readonly byProject = new WeakMap<Project, Map<string, PreparationCacheEntry>>();
  private readonly settled: SettledEntry[] = [];

  constructor(private readonly limit: number) {}

  get(project: Project, key: string): PreparationCacheEntry | undefined {
    const entry = this.byProject.get(project)?.get(key);
    if (entry === undefined) return undefined;
    const index = this.settled.findIndex((item) => item.entry === entry);
    if (index >= 0) {
      const [recent] = this.settled.splice(index, 1);
      if (recent !== undefined) this.settled.push(recent);
    }
    return entry;
  }

  set(project: Project, key: string, entry: PreparationCacheEntry): void {
    let cache = this.byProject.get(project);
    if (cache === undefined) {
      cache = new Map();
      this.byProject.set(project, cache);
    }
    const previous = cache.get(key);
    const index = this.settled.findIndex((item) => item.entry === previous);
    if (index >= 0) this.settled.splice(index, 1);
    cache.set(key, entry);
    const currentCache = cache;
    void entry.promise.then(
      () => {
        // A later Preview request can upgrade an in-flight estimate entry.
        // Its eventual estimate-only response must not replace that capability.
        if (currentCache.get(key) !== entry) return;
        this.settled.push({ project, key, entry });
        while (this.settled.length > this.limit) {
          const evicted = this.settled.shift();
          if (evicted !== undefined) this.delete(evicted);
        }
      },
      () => {
        if (currentCache.get(key) === entry) currentCache.delete(key);
      },
    );
  }

  clear(): void {
    for (const item of this.settled) this.delete(item);
    this.settled.length = 0;
  }

  private delete({ project, key, entry }: SettledEntry): void {
    const cache = this.byProject.get(project);
    if (cache?.get(key) === entry) cache.delete(key);
  }
}
