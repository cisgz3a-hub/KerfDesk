import type { SaveTarget } from '../../platform/types';

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
 * overlapping selections share a destination, replay the newest captured bytes
 * after their already-started writes so an older completion cannot stay final.
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
    void saveTargetsShareDestination(left.target, right.target)
      .then((matches) => {
        if (matches) this.mergeGroups(left, right);
      })
      .finally(() => {
        left.status.pendingComparisons -= 1;
        right.status.pendingComparisons -= 1;
        this.pruneOperations();
      });
  }

  private mergeGroups(left: SelectedProjectWrite, right: SelectedProjectWrite): void {
    const leftGroup = left.group;
    const rightGroup = right.group;
    if (leftGroup === rightGroup) return;

    const members = new Set([...leftGroup.members, ...rightGroup.members]);
    const merged: DestinationWriteGroup = {
      members,
      repairTail: Promise.resolve(),
      repairPending: true,
    };
    for (const member of members) member.group = merged;

    const prerequisites = Promise.all([
      leftGroup.repairTail,
      rightGroup.repairTail,
      ...[...members].map((member) => member.selectedSettled),
    ]);
    const repair = prerequisites.then(() => repairLatestWrite(merged));
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

async function repairLatestWrite(group: DestinationWriteGroup): Promise<void> {
  // Let successful selected-write owners publish before a repair failure asks
  // that exact handoff to become dirty again.
  await Promise.resolve();
  if (!isCurrentGroup(group)) return;
  const latest = latestWrite(group.members);
  try {
    await latest.target.write(latest.contents);
  } catch (error) {
    if (
      isCurrentGroup(group) &&
      latestWrite(group.members) === latest &&
      latest.status.selectedSucceeded
    ) {
      await reportRestoreFailure(latest, error);
    }
  }
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

export async function saveTargetsShareDestination(
  left: SaveTarget,
  right: SaveTarget,
): Promise<boolean> {
  if (left === right) return true;
  if (
    left.destinationIdentity !== undefined &&
    right.destinationIdentity !== undefined &&
    Object.is(left.destinationIdentity, right.destinationIdentity)
  ) {
    return true;
  }
  return eitherReportsSameDestination(left, right);
}

function eitherReportsSameDestination(left: SaveTarget, right: SaveTarget): Promise<boolean> {
  const comparisons = [reportsSameDestination(left, right), reportsSameDestination(right, left)];
  return new Promise((resolve) => {
    let remaining = comparisons.length;
    for (const comparison of comparisons) {
      void comparison.then((matches) => {
        if (matches) {
          resolve(true);
          return;
        }
        remaining -= 1;
        if (remaining === 0) resolve(false);
      });
    }
  });
}

async function reportsSameDestination(left: SaveTarget, right: SaveTarget): Promise<boolean> {
  if (left.isSameDestination === undefined) return false;
  try {
    return await left.isSameDestination(right);
  } catch {
    return false;
  }
}
