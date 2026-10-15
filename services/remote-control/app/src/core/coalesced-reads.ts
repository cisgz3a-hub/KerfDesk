import { store } from './store';
import { RemoteError } from './transport';

type Reader = {
  running: boolean;
  again: boolean;
  last: number;
  timer: ReturnType<typeof setTimeout> | null;
};
const reader = (): Reader => ({ running: false, again: false, last: 0, timer: null });

/** One connection's reads: at most one in flight plus one queued for each projection. */
export class CoalescedReads {
  private readonly readers = { workspace: reader(), machine: reader() };
  private stopped = false;

  stop(): void {
    this.stopped = true;
    for (const state of Object.values(this.readers))
      if (state.timer !== null) clearTimeout(state.timer);
  }

  async run(key: 'workspace' | 'machine', read: () => Promise<void>, minGap = 0): Promise<void> {
    if (this.stopped) return;
    const state = this.readers[key];
    if (state.running) {
      state.again = true;
      return;
    }
    const wait = state.last + minGap - Date.now();
    if (wait > 0) {
      if (state.timer === null)
        state.timer = setTimeout(() => {
          state.timer = null;
          void this.run(key, read, minGap);
        }, wait);
      return;
    }
    state.running = true;
    try {
      await read();
    } catch (error) {
      if (!this.stopped && error instanceof RemoteError && error.code === 'offline')
        store.set({ pcOnline: false });
    } finally {
      state.running = false;
      state.last = Date.now();
      if (!this.stopped && state.again) {
        state.again = false;
        void this.run(key, read, minGap);
      }
    }
  }
}
