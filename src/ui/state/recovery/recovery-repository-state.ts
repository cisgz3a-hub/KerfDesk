import { UNLOADED_RECOVERY_SNAPSHOT, type RecoveryRepositorySnapshot } from './recovery-model';

type SnapshotListener = () => void;
export type RecoveryAuthoritativeResetBase = {
  readonly snapshot: RecoveryRepositorySnapshot;
  readonly slotRevision: number | null;
};

export class RecoveryRepositoryState {
  snapshot: RecoveryRepositorySnapshot = UNLOADED_RECOVERY_SNAPSHOT;
  slotRevision: number | null = null;
  private readonly listeners = new Set<SnapshotListener>();

  constructor(private readonly onPendingStartCleared: () => void) {}

  getSnapshot = (): RecoveryRepositorySnapshot => this.snapshot;

  subscribe = (listener: SnapshotListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  isCurrent(snapshot: RecoveryRepositorySnapshot, slotRevision: number | null): boolean {
    return this.snapshot === snapshot && this.slotRevision === slotRevision;
  }

  publish(
    snapshot: RecoveryRepositorySnapshot,
    slotRevision: number,
    authoritativeResetBase?: RecoveryAuthoritativeResetBase,
  ): boolean {
    if (
      this.isOlder(snapshot.generation, slotRevision) &&
      (authoritativeResetBase === undefined ||
        !this.isCurrent(authoritativeResetBase.snapshot, authoritativeResetBase.slotRevision))
    ) {
      return false;
    }
    if (snapshot.pendingStart === null) this.onPendingStartCleared();
    this.snapshot = snapshot;
    this.slotRevision = slotRevision;
    for (const listener of this.listeners) listener();
    return true;
  }

  private isOlder(generation: number, slotRevision: number): boolean {
    if (!this.snapshot.loaded || this.slotRevision === null) return false;
    return (
      generation < this.snapshot.generation ||
      (generation === this.snapshot.generation && slotRevision < this.slotRevision)
    );
  }
}
