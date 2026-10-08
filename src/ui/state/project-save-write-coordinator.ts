import type { SaveDestinationComparison, SaveTarget } from '../../platform/types';
import { compareSaveDestinations } from './project-save-write-coordinator-identity';

export { saveTargetsShareDestination } from './project-save-write-coordinator-identity';

type SaveContents = Parameters<SaveTarget['write']>[0];

type SelectedWriteStatus = {
  selectedPending: boolean;
  selectedSucceeded: boolean;
  pendingComparisons: number;
};

type SelectedProjectWrite = {
  readonly id: number;
  readonly requestEpoch: number;
  readonly target: SaveTarget;
  readonly contents: SaveContents;
  readonly selected: Promise<void>;
  readonly selectedSettled: Promise<void>;
  readonly status: SelectedWriteStatus;
  readonly onRestoreFailure?: (error: unknown) => void | Promise<void>;
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
    onRestoreFailure?: (error: unknown) => void | Promise<void>,
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
    onRestoreFailure?: (error: unknown) => void | Promise<void>,
  ): Promise<void> {
    // This invocation intentionally precedes every identity comparison. Picker
    // equality can be slow; it never delays any destination the operator chose.
    const selected = invokeSelectedWrite(target, contents);
    const status: SelectedWriteStatus = {
      selectedPending: true,
      selectedSucceeded: false,
      pendingComparisons: 0,
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

async function repairCapturedWrites(group: DestinationWriteGroup): Promise<void> {
  // Let successful selected-write owners publish before a repair failure asks
  // that exact handoff to become dirty again.
  await Promise.resolve();
  if (!isCurrentGroup(group)) return;
  const latest = latestWrite(group.members);
  const writes = group.hasUnknownDestinations
    ? [...group.members].sort(compareWriteOrder).slice(1)
    : [latest];
  // The earliest chosen write already ran. Replay the later snapshots in
  // request order: aliases finish newest, distinct files keep their own bytes.
  for (const operation of writes) {
    if (!isCurrentGroup(group)) return;
    try {
      await operation.target.write(operation.contents);
    } catch (error) {
      if (isCurrentGroup(group) && operation === latest && latest.status.selectedSucceeded) {
        await reportRestoreFailure(latest, error);
      }
    }
  }
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

async function reportRestoreFailure(latest: SelectedProjectWrite, error: unknown): Promise<void> {
  try {
    await latest.onRestoreFailure?.(error);
  } catch {
    // Feedback failure must not reject another Save or poison future repairs.
  }
}
