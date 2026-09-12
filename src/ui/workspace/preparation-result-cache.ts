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

/** One reusable full Preview plus LRU-bounded estimates for exact project/options. */
export class PreparationResultCache {
  private readonly byProject = new WeakMap<Project, Map<string, PreparationCacheEntry>>();
  private readonly settled: SettledEntry[] = [];
  private previewGeneration = 0;

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
    if (entry.projection === 'preview') {
      this.discardSettledPreviews();
      this.previewGeneration++;
    }
    const previewGeneration = this.previewGeneration;
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
        // Keep the promise deliverable, but an older full request finishing
        // after a replacement began must not root another enormous route.
        if (entry.projection === 'preview' && previewGeneration !== this.previewGeneration) {
          currentCache.delete(key);
          return;
        }
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

  /** Drop completed geometry before another request is posted or materialized. */
  discardSettledPreviews(): void {
    for (let index = this.settled.length - 1; index >= 0; index--) {
      const item = this.settled[index];
      if (item === undefined || item.entry.projection !== 'preview') continue;
      this.settled.splice(index, 1);
      this.delete(item);
    }
  }

  clear(): void {
    this.previewGeneration++;
    for (const item of this.settled) this.delete(item);
    this.settled.length = 0;
  }

  private delete({ project, key, entry }: SettledEntry): void {
    const cache = this.byProject.get(project);
    if (cache?.get(key) === entry) cache.delete(key);
  }
}
