import type { Project, RasterImage, SceneObject } from '../../core/scene';
import type { InteractionHistorySnapshot } from '../state/interaction-history-snapshot';
import { IndexedDbPagedAssetLeaseRepository } from './paged-asset-indexeddb-leases';

export type PagedRasterOwnershipState = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly pendingUndo: InteractionHistorySnapshot | null;
  readonly sceneClipboard: { readonly objects: ReadonlyArray<SceneObject> } | null;
};

type AssetRetentionRepository = {
  cancelDelete(assetId: string): Promise<void>;
};

type CleanupFailureReporter = (assetIds: ReadonlyArray<string>) => void;

export class PagedRasterAssetLifecycle {
  private referenced = new Set<string>();
  private readonly pendingRetention = new Set<string>();
  private drainChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: AssetRetentionRepository = new IndexedDbPagedAssetLeaseRepository(),
    private readonly reportCleanupFailure: CleanupFailureReporter = (assetIds) => {
      console.error(
        'Page-backed raster retention repair failed; repair will be retried.',
        assetIds,
      );
    },
  ) {}

  transition(
    previous: PagedRasterOwnershipState,
    current: PagedRasterOwnershipState,
  ): Promise<void> {
    const previousIds = collectPagedRasterAssetIds(previous);
    this.referenced = collectPagedRasterAssetIds(current);
    // Native project and autosave JSON currently persist only page-asset IDs,
    // while their owning files/slots are outside this live Zustand state.
    // Therefore absence here is not proof that a ready asset is orphaned.
    // Retain ready pages until persistence either embeds them or durably
    // enumerates every external owner; only repair older deferred deletions
    // when an asset becomes live again.
    for (const assetId of this.referenced) {
      if (!previousIds.has(assetId)) this.pendingRetention.add(assetId);
    }
    return this.scheduleDrain();
  }

  private scheduleDrain(): Promise<void> {
    this.drainChain = this.drainChain.then(() => this.drainOnce());
    return this.drainChain;
  }

  private async drainOnce(): Promise<void> {
    const failed: string[] = [];
    for (const assetId of [...this.pendingRetention]) {
      if (!this.referenced.has(assetId)) {
        this.pendingRetention.delete(assetId);
        continue;
      }
      try {
        await this.repository.cancelDelete(assetId);
        this.pendingRetention.delete(assetId);
      } catch {
        failed.push(assetId);
      }
    }
    if (failed.length > 0) this.reportCleanupFailure(failed);
  }
}

export function collectPagedRasterAssetIds(state: PagedRasterOwnershipState): Set<string> {
  const assetIds = new Set<string>();
  for (const project of projectsIn(state)) collectObjectAssetIds(project.scene.objects, assetIds);
  collectObjectAssetIds(state.sceneClipboard?.objects ?? [], assetIds);
  return assetIds;
}

const lifecycle = new PagedRasterAssetLifecycle();

export function observePagedRasterOwnershipTransition(
  previous: PagedRasterOwnershipState,
  current: PagedRasterOwnershipState,
): Promise<void> {
  return lifecycle.transition(previous, current);
}

function projectsIn(state: PagedRasterOwnershipState): ReadonlyArray<Project> {
  return [
    state.project,
    ...state.undoStack,
    ...state.redoStack,
    ...(state.pendingUndo === null ? [] : [state.pendingUndo.project]),
  ];
}

function collectObjectAssetIds(objects: ReadonlyArray<SceneObject>, assetIds: Set<string>): void {
  for (const object of objects) {
    if (object.kind !== 'raster-image' || object.imageAsset === undefined) continue;
    for (const assetId of assetIdsFor(object.imageAsset)) assetIds.add(assetId);
  }
}

function assetIdsFor(asset: NonNullable<RasterImage['imageAsset']>): readonly [string, string] {
  return [asset.sourceAssetId, asset.lumaAssetId];
}
