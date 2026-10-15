import { canEdit, store } from './store';
import { selectableIds } from './scene';
import type { Workspace } from './types';

type Result = { revision?: string; selection?: string[] } | null;
type Intent = { args: { artworkIds?: string[]; mode?: 'all' }; version: number };
type Send = (args: Intent['args'], revision: string) => Promise<Result>;

/** Selection is replaceable intent: send one request at a time and keep the latest choice. */
export class SelectionSync {
  version = 0;
  private next: Intent | null = null;
  private running: Promise<boolean> | null = null;
  private stopped = false;
  private revisions = new Set<string>();
  private confirmedRevision: string | null = null;

  constructor(
    private readonly send: Send,
    private readonly refresh: () => Promise<void>,
  ) {}

  get pending(): boolean {
    return this.running !== null;
  }

  stop(): void {
    this.stopped = true;
    this.next = null;
    this.version += 1;
  }

  wait(): Promise<boolean> {
    return this.running ?? Promise.resolve(true);
  }

  revision(current: string): string {
    return this.revisions.has(current) ? (this.confirmedRevision ?? current) : current;
  }

  forgetRevision(): void {
    this.revisions.clear();
    this.confirmedRevision = null;
  }

  select(ids: string[]): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const unique = [...new Set(ids)];
    if (unique.length > 200) {
      store.toast('Select up to 200 artwork items at a time. Your selection was kept.', 'warning');
      return Promise.resolve();
    }
    const editable = canEdit(store.get());
    store.set({ selection: unique, selectionSync: editable ? 'pending' : 'local' });
    if (!editable) {
      this.version += 1;
      this.next = null;
      return Promise.resolve();
    }
    return this.enqueue({ artworkIds: unique });
  }

  all(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const current = store.get();
    if (!canEdit(current) || current.workspace?.capabilities?.selectionModes !== true) {
      if (
        current.workspace !== null &&
        current.workspace.artwork.length < current.workspace.totalArtwork
      ) {
        store.toast(
          'The PC has more artwork than this view can list. Select a smaller area.',
          'warning',
        );
        return Promise.resolve();
      }
      return this.select(selectableIds(current.workspace?.artwork ?? [], current.scene));
    }
    store.set({ selectionSync: 'pending' });
    return this.enqueue({ mode: 'all' });
  }

  reconcile(workspace: Workspace, version: number, pending: boolean) {
    const current = store.get();
    if (current.pending > 0 || pending || this.pending || version !== this.version)
      return { selection: current.selection };
    if (current.selectionSync === 'local' && !canEdit({ ...current, workspace }))
      return {
        selection: current.selection.filter((id) =>
          workspace.artwork.some((item) => item.id === id),
        ),
      };
    return { selection: workspace.selection, selectionSync: 'desktop' as const };
  }

  private enqueue(args: Intent['args']): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.next = { args, version: ++this.version };
    // Defer the first dispatch so pending is visible to reads before the write begins.
    this.running ??= Promise.resolve().then(() => this.drain());
    return this.running.then(() => undefined);
  }

  private async drain(): Promise<boolean> {
    try {
      while (this.next !== null && !this.stopped) {
        const intent = this.next;
        this.next = null;
        const workspace = store.get().workspace;
        if (workspace === null) return false;
        const expected = this.revision(workspace.revision);
        const result = await this.send(intent.args, expected);
        if (this.stopped) return false;
        if (typeof result?.revision === 'string') {
          if (!this.revisions.has(expected)) this.revisions.clear();
          this.revisions.add(expected);
          this.revisions.add(result.revision);
          this.confirmedRevision = result.revision;
        }
        if (intent.version === this.version) {
          store.set({
            selection: result?.selection ?? store.get().workspace?.selection ?? [],
            selectionSync: 'desktop',
          });
        }
        // A rejected revision must be reviewed; never replay queued intent against new artwork.
        if (result === null) {
          this.next = null;
          if (store.get().selectionSync !== 'local')
            store.set({
              selection: store.get().workspace?.selection ?? [],
              selectionSync: 'desktop',
            });
          return false;
        }
      }
      return !this.stopped;
    } finally {
      this.running = null;
      if (!this.stopped) void this.refresh();
    }
  }
}
