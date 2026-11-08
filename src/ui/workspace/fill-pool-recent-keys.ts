// Values kept per pool key for the keys of the last two plans (S9-P3-3).
//
// fill-pools.ts keeps each pool key's last overlap groups so a drag of the
// object that anchors its cluster cache still finds what it is moving away
// from (ADR-683 Amendment 3). Each value holds the pool's scene objects, with
// their geometry. Once a key's pool is gone (its operation's last member
// undone or deleted, a new project opened) nothing would read it again, yet
// it was kept for the rest of the session: each traced image left 0.15–7 MB.
// The two canvases that plan in turn (the reason fill-pool-plan-cache.ts keeps
// two plans) must not evict each other's keys, so a key is dropped only once
// neither of the last two plans has used it.

export class RecentPlanValues<V> {
  private readonly values = new Map<string, V>();
  private previous = new Set<string>();
  private current = new Set<string>();

  get(key: string): V | undefined {
    return this.values.get(key);
  }

  set(key: string, value: V): void {
    this.values.set(key, value);
    this.current.add(key);
  }

  /** Close a plan: drop every key neither it nor the plan before it used. */
  endPlan(): void {
    for (const key of this.values.keys()) {
      if (!this.current.has(key) && !this.previous.has(key)) this.values.delete(key);
    }
    this.previous = this.current;
    this.current = new Set();
  }

  get size(): number {
    return this.values.size;
  }
}
