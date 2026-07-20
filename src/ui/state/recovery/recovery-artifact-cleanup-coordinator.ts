import type { RunId } from './execution-artifact';
import { cleanupDisplacedRecoveryArtifacts } from './recovery-artifact-cleanup';
import type { RecoveryStorageBackend } from './recovery-backend';
import type { RecoveryRepositorySnapshot } from './recovery-model';

const ORPHAN_RECONCILIATION_RETRY_MS = 30_000;

export class RecoveryArtifactCleanupCoordinator {
  private retryRunIds: ReadonlySet<RunId> = new Set();
  private startupReconciliationPending = true;
  private reconciliationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly options: {
      readonly backend: RecoveryStorageBackend;
      readonly isStaged: (runId: RunId) => boolean;
      readonly stagedRuns: () => ReadonlySet<RunId>;
      readonly currentGeneration: () => number;
      readonly onFailure: (operation: string, error: unknown) => void;
    },
  ) {}

  clear(): void {
    this.retryRunIds = new Set();
    this.startupReconciliationPending = false;
    this.clearReconciliationTimer();
  }

  async afterInitialization(): Promise<void> {
    await this.reconcileOrphans();
  }

  async afterMutation(
    before: RecoveryRepositorySnapshot,
    after: RecoveryRepositorySnapshot,
  ): Promise<void> {
    this.retryRunIds = await cleanupDisplacedRecoveryArtifacts({
      backend: this.options.backend,
      before,
      after,
      retryRunIds: this.retryRunIds,
      isStaged: this.options.isStaged,
      onFailure: (runId, error) =>
        this.options.onFailure(
          'clean up superseded recovery artifact',
          new Error(`${runId}: ${errorMessage(error)}`),
        ),
    });
    if (this.startupReconciliationPending) await this.reconcileOrphans();
  }

  private async reconcileOrphans(): Promise<void> {
    const retained = this.options.stagedRuns();
    try {
      const retryAtEpochMs = await this.options.backend.deleteArtifactsExcept(retained, {
        generation: this.options.currentGeneration(),
      });
      this.scheduleReconciliation(retryAtEpochMs);
    } catch (error) {
      this.scheduleReconciliation(Date.now() + ORPHAN_RECONCILIATION_RETRY_MS);
      this.options.onFailure('reconcile orphaned recovery artifacts', error);
    }
  }

  private scheduleReconciliation(retryAtEpochMs: number | null): void {
    this.clearReconciliationTimer();
    this.startupReconciliationPending = retryAtEpochMs !== null;
    if (retryAtEpochMs === null) return;
    this.reconciliationTimer = setTimeout(
      () => {
        this.reconciliationTimer = null;
        void this.reconcileOrphans();
      },
      Math.max(0, retryAtEpochMs - Date.now()),
    );
  }

  private clearReconciliationTimer(): void {
    if (this.reconciliationTimer === null) return;
    clearTimeout(this.reconciliationTimer);
    this.reconciliationTimer = null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
