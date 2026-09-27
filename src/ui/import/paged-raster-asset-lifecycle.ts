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
  private drainPromise: Promise<void> | null = null;
  private drainRequested = false;

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
    if (!sameOwnershipInputs(previous, current)) {
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
    }
    // An unchanged selection/cursor tick does no history scan. Failed repairs
    // still get a retry on a later transition, even with unchanged ownership.
    return this.pendingRetention.size === 0
      ? (this.drainPromise ?? DRAIN_COMPLETE)
      : this.scheduleDrain();
  }

  private scheduleDrain(): Promise<void> {
    this.drainRequested = true;
    if (this.drainPromise !== null) return this.drainPromise;
    this.drainPromise = Promise.resolve().then(async () => {
      try {
        do {
          this.drainRequested = false;
          await this.drainOnce();
        } while (this.drainRequested);
      } finally {
        this.drainPromise = null;
      }
    });
    return this.drainPromise;
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
  const seenObjects = new Set<ReadonlyArray<SceneObject>>();
  for (const project of projectsIn(state)) collectOnce(project.scene.objects);
  if (state.sceneClipboard !== null) collectOnce(state.sceneClipboard.objects);
  return assetIds;

  function collectOnce(objects: ReadonlyArray<SceneObject>): void {
    if (seenObjects.has(objects)) return;
    seenObjects.add(objects);
    for (const assetId of objectAssetIds(objects)) assetIds.add(assetId);
  }
}

const DRAIN_COMPLETE = Promise.resolve();
// Scene/history updates replace immutable object arrays. Weak keys let undo
// eviction release the cache; returned ownership sets never expose cached sets.
const objectAssetIdCache = new WeakMap<ReadonlyArray<SceneObject>, ReadonlySet<string>>();

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

function objectAssetIds(objects: ReadonlyArray<SceneObject>): ReadonlySet<string> {
  const cached = objectAssetIdCache.get(objects);
  if (cached !== undefined) return cached;
  const assetIds = new Set<string>();
  for (const object of objects) {
    if (object.kind !== 'raster-image' || object.imageAsset === undefined) continue;
    for (const assetId of assetIdsFor(object.imageAsset)) assetIds.add(assetId);
  }
  objectAssetIdCache.set(objects, assetIds);
  return assetIds;
}

function sameOwnershipInputs(
  previous: PagedRasterOwnershipState,
  current: PagedRasterOwnershipState,
): boolean {
  return (
    previous.project.scene.objects === current.project.scene.objects &&
    previous.undoStack === current.undoStack &&
    previous.redoStack === current.redoStack &&
    previous.pendingUndo?.project.scene.objects === current.pendingUndo?.project.scene.objects &&
    previous.sceneClipboard?.objects === current.sceneClipboard?.objects
  );
}

function assetIdsFor(asset: NonNullable<RasterImage['imageAsset']>): readonly [string, string] {
  return [asset.sourceAssetId, asset.lumaAssetId];
}
