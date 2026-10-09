import type { SaveDestinationComparison, SaveTarget } from '../../platform/types';
import { compareSaveDestinations } from './project-save-write-coordinator-identity';

export { saveTargetsShareDestination } from './project-save-write-coordinator-identity';

type SaveContents = Parameters<SaveTarget['write']>[0];
export type ProjectSaveOwnReplayResult =
  | { readonly kind: 'restored' }
  | { readonly kind: 'failed'; readonly error: unknown }
  | { readonly kind: 'cancelled' };

type RestoreFailureFeedback = (
  error: unknown,
  ownReplay?: Promise<ProjectSaveOwnReplayResult>,
) => void | Promise<void>;

type SelectedWriteStatus = {
  selectedPending: boolean;
  selectedSucceeded: boolean;
  pendingComparisons: number;
  destinationComparisons: ReadonlyMap<number, SaveDestinationComparison>;
};

type SelectedProjectWrite = {
  readonly id: number;
  readonly requestEpoch: number;
  readonly target: SaveTarget;
  readonly contents: SaveContents;
  readonly selected: Promise<void>;
  readonly selectedSettled: Promise<void>;
  readonly status: SelectedWriteStatus;
  readonly onRestoreFailure?: RestoreFailureFeedback;
  group: DestinationWriteGroup;
};

type DestinationWriteGroup = {
  readonly members: ReadonlySet<SelectedProjectWrite>;
  readonly hasUnknownDestinations: boolean;
  repairTail: Promise<void>;
  repairPending: boolean;
};

export type ProjectSaveWriteOwner = {
  readonly write: (
    target: SaveTarget,
    contents: SaveContents,
    onRestoreFailure?: RestoreFailureFeedback,
  ) => Promise<void>;
  readonly release: () => void;
};

export type ProjectSaveWriteCoordinator = {
  readonly begin: (requestEpoch: number) => ProjectSaveWriteOwner;
};

/**
 * Launch every selected write immediately. Once adapter identity proves that
 * overlapping selections share a destination, replay the newest captured bytes.
 * Unproven aliases replay each destination's own bytes in request order after
 * the selected writes, without mixing payloads or blocking selected writes.
 */
export function createProjectSaveWriteCoordinator(): ProjectSaveWriteCoordinator {
  return new ProjectSaveWriteCoordinatorState().coordinator;
}

class ProjectSaveWriteCoordinatorState {
  private activeRequestEpochs: ReadonlySet<number> = new Set();
  private operations: ReadonlyArray<SelectedProjectWrite> = [];
  private nextOperationId = 1;

  readonly coordinator: ProjectSaveWriteCoordinator = {
    begin: (requestEpoch) => this.begin(requestEpoch),
  };

  private begin(requestEpoch: number): ProjectSaveWriteOwner {
    this.activeRequestEpochs = new Set([...this.activeRequestEpochs, requestEpoch]);
    let isReleased = false;
    return {
      write: (target, contents, onRestoreFailure) =>
        this.registerSelectedWrite(requestEpoch, target, contents, onRestoreFailure),
      release: () => {
        if (isReleased) return;
        isReleased = true;
        this.activeRequestEpochs = new Set(
          [...this.activeRequestEpochs].filter((epoch) => epoch !== requestEpoch),
        );
        this.pruneOperations();
      },
    };
  }

  private registerSelectedWrite(
    requestEpoch: number,
    target: SaveTarget,
    contents: SaveContents,
    onRestoreFailure?: RestoreFailureFeedback,
  ): Promise<void> {
    // This invocation intentionally precedes every identity comparison. Picker
    // equality can be slow; it never delays any destination the operator chose.
    const selected = invokeSelectedWrite(target, contents);
    const status: SelectedWriteStatus = {
      selectedPending: true,
      selectedSucceeded: false,
      pendingComparisons: 0,
      destinationComparisons: new Map(),
    };
    const selectedSettled = selected.then(
      () => {
        status.selectedPending = false;
        status.selectedSucceeded = true;
        this.pruneOperations();
      },
      () => {
        status.selectedPending = false;
        this.pruneOperations();
      },
    );
    const operation: SelectedProjectWrite = {
      id: this.nextOperationId++,
      requestEpoch,
      target,
      contents,
      selected,
      selectedSettled,
      status,
      ...(onRestoreFailure === undefined ? {} : { onRestoreFailure }),
      group: undefined as unknown as DestinationWriteGroup,
    };
    operation.group = newWriteGroup(operation);

    const earlierOperations = this.operations;
    this.operations = [...this.operations, operation];
    for (const earlier of earlierOperations) this.compareOperations(earlier, operation);
    return selected;
  }

  private compareOperations(left: SelectedProjectWrite, right: SelectedProjectWrite): void {
    left.status.pendingComparisons += 1;
    right.status.pendingComparisons += 1;
    let pendingPair: { left: SelectedProjectWrite; right: SelectedProjectWrite } | undefined = {
      left,
      right,
    };
    const settleComparison = (result: SaveDestinationComparison): void => {
      const pair = pendingPair;
      if (!pair) return;
      pendingPair = undefined;
      try {
        pair.left.status.destinationComparisons = new Map([
          ...pair.left.status.destinationComparisons,
          [pair.right.id, result],
        ]);
        pair.right.status.destinationComparisons = new Map([
          ...pair.right.status.destinationComparisons,
          [pair.left.id, result],
        ]);
        if (result !== 'different') this.mergeGroups(pair.left, pair.right, result === 'unknown');
      } finally {
        pair.left.status.pendingComparisons -= 1;
        pair.right.status.pendingComparisons -= 1;
        this.pruneOperations();
      }
    };
    void compareSaveDestinations(left.target, right.target).then(settleComparison, () =>
      settleComparison('unknown'),
    );
    // A stalled identity lookup cannot leave an older write final. Once both
    // chosen writes settle, adopt conservative repair and retire the comparison.
    // Late identity results cannot restart that repair or retain saved snapshots.
    void Promise.all([left.selectedSettled, right.selectedSettled]).then(() => {
      settleComparison('unknown');
    });
  }

  private mergeGroups(
    left: SelectedProjectWrite,
    right: SelectedProjectWrite,
    unknown: boolean,
  ): void {
    const leftGroup = left.group;
    const rightGroup = right.group;
    // No carrier joins an existing group here. Its connecting comparisons have
    // already proved shared identity or promoted it to unknown destinations.
    if (leftGroup === rightGroup) return;

    const members = new Set([...leftGroup.members, ...rightGroup.members]);
    const merged: DestinationWriteGroup = {
      members,
      hasUnknownDestinations:
        unknown || leftGroup.hasUnknownDestinations || rightGroup.hasUnknownDestinations,
      repairTail: Promise.resolve(),
      repairPending: true,
    };
    for (const member of members) member.group = merged;

    const prerequisites = Promise.all([
      leftGroup.repairTail,
      rightGroup.repairTail,
      ...[...members].map((member) => member.selectedSettled),
    ]);
    const repair = prerequisites.then(() => repairCapturedWrites(merged));
    merged.repairTail = settledPromise(repair).then(() => {
      if (isCurrentGroup(merged)) merged.repairPending = false;
      this.pruneOperations();
    });
  }

  private pruneOperations(): void {
    this.operations = this.operations.filter(
      (operation) =>
        operation.status.selectedPending ||
        operation.status.pendingComparisons > 0 ||
        operation.group.repairPending ||
        this.activeRequestEpochs.has(operation.requestEpoch) ||
        [...this.activeRequestEpochs].some((epoch) => epoch < operation.requestEpoch),
    );
  }
}

function newWriteGroup(operation: SelectedProjectWrite): DestinationWriteGroup {
  return {
    members: new Set([operation]),
    hasUnknownDestinations: false,
    repairTail: Promise.resolve(),
    repairPending: false,
  };
}

function invokeSelectedWrite(target: SaveTarget, contents: SaveContents): Promise<void> {
  try {
    return Promise.resolve(target.write(contents));
  } catch (error) {
    const reason = error instanceof Error ? error : new Error(String(error));
    return Promise.reject(reason);
  }
}

function settledPromise(promise: Promise<unknown>): Promise<void> {
  return promise.then(
    () => undefined,
    () => undefined,
  );
}

type ReplayResult = {
  readonly operation: SelectedProjectWrite;
  readonly index: number;
};
type FailedReplay = ReplayResult & { readonly error: unknown };
type PendingOwnerRestoration = {
  readonly completed: Promise<ProjectSaveOwnReplayResult>;
  readonly settle: (result: ProjectSaveOwnReplayResult) => void;
};

async function repairCapturedWrites(group: DestinationWriteGroup): Promise<void> {
  // Let successful selected-write owners publish before a repair failure asks
  // that exact handoff to become dirty again.
  await Promise.resolve();
  if (!isCurrentGroup(group)) return;
  const latest = latestWrite(group.members);
  const writes = group.hasUnknownDestinations
    ? [...group.members].sort(compareWriteOrder).slice(1)
    : [latest];
  const failures: FailedReplay[] = [];
  const restored: ReplayResult[] = [];
  const notifiedOwners = new Set<number>();
  const pendingRestorations = new Map<number, PendingOwnerRestoration>();
  // The earliest chosen write already ran. Replay the later snapshots in
  // request order: aliases finish newest, distinct files keep their own bytes.
  for (const [index, operation] of writes.entries()) {
    if (!isCurrentGroup(group)) {
      // Supersession cancels the remaining own replays, not completed failures.
      for (const id of pendingRestorations.keys())
        settleOwnerRestoration(pendingRestorations, notifiedOwners, id, { kind: 'cancelled' });
      reportAffectedSaveOwners(group, failures, restored, [], notifiedOwners, pendingRestorations);
      return;
    }
    try {
      await operation.target.write(operation.contents);
      restored.push({ operation, index });
      settleOwnerRestoration(pendingRestorations, notifiedOwners, operation.id, {
        kind: isCurrentGroup(group) ? 'restored' : 'cancelled',
      });
    } catch (error) {
      failures.push({ operation, index, error });
      settleOwnerRestoration(pendingRestorations, notifiedOwners, operation.id, {
        kind: 'failed',
        error,
      });
      reportAffectedSaveOwners(
        group,
        failures,
        restored,
        writes.slice(index + 1),
        notifiedOwners,
        pendingRestorations,
      );
    }
  }
  reportAffectedSaveOwners(group, failures, restored, [], notifiedOwners, pendingRestorations);
}

function reportAffectedSaveOwners(
  group: DestinationWriteGroup,
  failures: ReadonlyArray<FailedReplay>,
  restored: ReadonlyArray<ReplayResult>,
  pending: ReadonlyArray<SelectedProjectWrite>,
  notifiedOwners: Set<number>,
  pendingRestorations: Map<number, PendingOwnerRestoration>,
): void {
  // A failed later selection does not replace a successful handoff. A throwing
  // write may already have changed an unknown alias, so notify each potentially
  // affected successful owner. Its saved-epoch/document guards decide ownership,
  // even if a newer pending selection has superseded this repair group.
  for (const owner of group.members) {
    if (!owner.status.selectedSucceeded || notifiedOwners.has(owner.id)) continue;
    const failure = [...failures]
      .reverse()
      .find(
        (failed) =>
          owner.status.destinationComparisons.get(failed.operation.id) !== 'different' &&
          !restored.some(
            (successful) =>
              successful.index > failed.index &&
              (successful.operation === owner ||
                (owner.status.destinationComparisons.get(successful.operation.id) === 'same' &&
                  Object.is(successful.operation.contents, owner.contents))),
          ),
      );
    if (!failure) continue;
    if (pending.includes(owner)) {
      if (!pendingRestorations.has(owner.id)) {
        let settle = (_result: ProjectSaveOwnReplayResult): void => undefined;
        const completed = new Promise<ProjectSaveOwnReplayResult>((resolve) => {
          settle = resolve;
        });
        pendingRestorations.set(owner.id, { completed, settle });
        // Arm recovery now: another file's replay may never settle. Only this
        // owner's own successful replay can release that temporary uncertainty.
        void reportRestoreFailure(owner, failure.error, completed);
      }
    } else {
      notifiedOwners.add(owner.id);
      void reportRestoreFailure(owner, failure.error);
    }
  }
}

function settleOwnerRestoration(
  pending: Map<number, PendingOwnerRestoration>,
  notifiedOwners: Set<number>,
  id: number,
  result: ProjectSaveOwnReplayResult,
): void {
  const restoration = pending.get(id);
  if (!restoration) return;
  pending.delete(id);
  if (result.kind !== 'restored') notifiedOwners.add(id);
  restoration.settle(result);
}

function compareWriteOrder(left: SelectedProjectWrite, right: SelectedProjectWrite): number {
  return left.requestEpoch - right.requestEpoch || left.id - right.id;
}

function isCurrentGroup(group: DestinationWriteGroup): boolean {
  return [...group.members].every((member) => member.group === group);
}

function latestWrite(operations: ReadonlySet<SelectedProjectWrite>): SelectedProjectWrite {
  return [...operations].reduce((latest, candidate) =>
    candidate.requestEpoch > latest.requestEpoch ||
    (candidate.requestEpoch === latest.requestEpoch && candidate.id > latest.id)
      ? candidate
      : latest,
  );
}

async function reportRestoreFailure(
  owner: SelectedProjectWrite,
  error: unknown,
  ownReplay?: Promise<ProjectSaveOwnReplayResult>,
): Promise<void> {
  try {
    await owner.onRestoreFailure?.(error, ownReplay);
  } catch {
    // Feedback failure must not reject another Save or poison future repairs.
  }
}
