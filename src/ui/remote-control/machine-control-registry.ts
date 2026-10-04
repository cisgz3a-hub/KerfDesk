import { useStore } from '../state/store';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { MACHINE_COMMANDS, validateMachineCommand } from './machine-validation';
import { machineOperationProjection, machineStatusProjection } from './machine-projections';
import { executeMachineOperation } from './machine-execution';
import { operationIsTerminal, type OwnedMachineOperation } from './machine-operation-state';
import {
  assertMachineOperationOwned,
  cancelMachineOperation,
  ownMachineOperation,
  recordMachineOperationFailure,
  currentMachineReviewForApproval,
  type MachineAction,
  type BackgroundMachineAction,
} from './machine-owned-operation';
import { RemoteFault } from './fault';
import type { MachineAuthority, MachineCommand, RemoteCaller } from './machine-types';
import type { RemoteAppStore, RemoteCommandResult, RemoteControlOptions } from './types';

type Execution = {
  readonly signal?: AbortSignal;
  readonly machineAuthority?: MachineAuthority | null;
  readonly remoteCaller?: RemoteCaller | null;
};
type Receipt = {
  readonly fingerprint: string;
  readonly operation: OwnedMachineOperation;
  readonly id: string;
};
type ProjectionSource = {
  readonly caller: RemoteCaller;
  readonly id?: string;
  readonly operation?: OwnedMachineOperation;
  readonly status: boolean;
};
const MAX_ACTIONS = 4096;
const MAX_ABORTS = 256;

/** One renderer session owns receipts; ordinary handed-off jobs keep their native lifecycle. */
export class MachineControlRegistry {
  private readonly receipts = new Map<string, Receipt>();
  private readonly operations = new Map<string, OwnedMachineOperation>();
  private readonly sources = new WeakMap<object, ProjectionSource>();
  private readonly store: RemoteAppStore;
  private disposed = false;
  constructor(
    private readonly options: RemoteControlOptions,
    private readonly revision: () => string,
  ) {
    this.store = options.store ?? useStore;
  }
  readonly handles = (command: string) => MACHINE_COMMANDS.has(command);
  readonly execute = (
    command: string,
    args: unknown,
    execution: Execution = {},
  ): RemoteCommandResult => {
    if (this.disposed) throw new RemoteFault('cancelled');
    execution.signal?.throwIfAborted();
    const input = validateMachineCommand(command, args);
    const caller = this.caller(execution);
    if (input.command === 'get_machine_status')
      return this.result(caller, undefined, undefined, true);
    if (input.command === 'get_control_operation')
      return this.result(
        caller,
        input.args.operationId,
        this.operations.get(key(caller, input.args.operationId)),
        false,
      );
    const fingerprint = canonical(input);
    const cached = this.replay(input, caller, fingerprint);
    if (cached !== null) return cached;
    const authority = this.assertAdmission(input, caller, execution);
    this.retireRevokedReceipts();
    this.assertCapacity(input, caller);
    if (input.command === 'start_job') return this.approve(input, caller, authority, fingerprint);
    this.assertVacant(input);
    const operation = ownMachineOperation(input, authority, this.store, this.revision);
    if (input.command === 'abort_job')
      for (const existing of new Set(this.operations.values()))
        cancelMachineOperation(existing, false);
    this.reserve(input.args.requestId, caller, fingerprint, operation);
    this.schedule(input, operation);
    return this.result(caller, input.args.requestId, operation, false);
  };
  private caller(execution: Execution): RemoteCaller {
    const caller =
      execution.remoteCaller === undefined
        ? this.options.getRemoteCaller?.()
        : execution.remoteCaller;
    if (caller == null) throw new RemoteFault('unavailable');
    return caller;
  }
  private replay(
    input: MachineAction,
    caller: RemoteCaller,
    fingerprint: string,
  ): RemoteCommandResult | null {
    const cached = this.receipts.get(key(caller, input.args.requestId));
    if (cached === undefined) return null;
    if (cached.fingerprint !== fingerprint) throw new RemoteFault('request_conflict');
    return this.result(caller, cached.id, cached.operation, false);
  }
  private assertAdmission(
    input: MachineAction,
    caller: RemoteCaller,
    execution: Execution,
  ): MachineAuthority {
    const authority =
      execution.machineAuthority === undefined
        ? this.options.captureMachineAuthority?.()
        : execution.machineAuthority;
    if (
      authority == null ||
      authority.clientId !== caller.clientId ||
      authority.sessionId !== caller.sessionId
    )
      throw new RemoteFault('control_required');
    authority.signal.throwIfAborted();
    authority.assertCurrent();
    if ('expectedRevision' in input.args && input.args.expectedRevision !== this.revision())
      throw new RemoteFault('stale_revision');
    return authority;
  }
  private assertCapacity(input: MachineAction, caller: RemoteCaller): void {
    const prefix = `${caller.sessionId}/${caller.clientId}/`;
    const own = [...this.receipts]
      .filter(([receiptKey]) => receiptKey.startsWith(prefix))
      .map(([, receipt]) => receipt);
    const aborting = input.command === 'abort_job';
    if (
      own.filter((receipt) => (receipt.operation.kind === 'abort') === aborting).length >=
      (aborting ? MAX_ABORTS : MAX_ACTIONS)
    )
      throw new RemoteFault('request_limit');
  }
  private assertVacant(input: BackgroundMachineAction): void {
    if (input.command === 'abort_job') return;
    const activePreparation = [...new Set(this.operations.values())].some(
      (operation) =>
        !operationIsTerminal(operation) &&
        !(operation.kind === 'job' && operation.committed !== false),
    );
    if (
      activePreparation ||
      (input.command === 'frame_job' && useFramePreparationStore.getState().pending)
    )
      throw new RemoteFault('busy');
  }
  private schedule(input: BackgroundMachineAction, operation: OwnedMachineOperation): void {
    const assertOwned = (owned: OwnedMachineOperation) =>
      assertMachineOperationOwned(owned, this.store, this.disposed);
    void Promise.resolve()
      .then(() =>
        executeMachineOperation(input, operation, {
          options: { ...this.options, store: this.store },
          revision: this.revision,
          assertOwned,
        }),
      )
      .catch((error: unknown) => recordMachineOperationFailure(operation, error))
      .finally(() => operation.cleanup());
  }
  private reserve(
    id: string,
    caller: RemoteCaller,
    fingerprint: string,
    operation: OwnedMachineOperation,
  ): void {
    this.receipts.set(key(caller, id), { id, fingerprint, operation });
    this.operations.set(key(caller, id), operation);
  }
  private approve(
    input: Extract<MachineCommand, { readonly command: 'start_job' }>,
    caller: RemoteCaller,
    authority: MachineAuthority,
    fingerprint: string,
  ): RemoteCommandResult {
    const operation = [...new Set(this.operations.values())].find(
      (candidate) =>
        candidate.review?.id === input.args.reviewId &&
        candidate.authority.clientId === caller.clientId &&
        candidate.authority.sessionId === caller.sessionId,
    );
    if (operation === undefined) throw new RemoteFault('not_found');
    assertMachineOperationOwned(operation, this.store, this.disposed);
    authority.assertCurrent();
    const review = currentMachineReviewForApproval(operation, this.revision());
    this.reserve(input.args.requestId, caller, fingerprint, operation);
    delete operation.review;
    operation.state = 'starting';
    review.presentation.confirm();
    return this.result(caller, input.args.requestId, operation, false);
  }
  private result(
    caller: RemoteCaller,
    id: string | undefined,
    operation: OwnedMachineOperation | undefined,
    status: boolean,
  ): RemoteCommandResult {
    const data = status ? this.statusData(caller) : this.operationData(id, operation);
    this.sources.set(data, {
      caller,
      ...(id === undefined ? {} : { id }),
      ...(operation === undefined ? {} : { operation }),
      status,
    });
    return { ok: true, revision: this.revision(), data };
  }
  private statusData(caller: RemoteCaller): Record<string, unknown> {
    const latest = [...this.receipts]
      .reverse()
      .find(([receiptKey]) => receiptKey.startsWith(`${caller.sessionId}/${caller.clientId}/`));
    return {
      ...machineStatusProjection(this.options, this.canControlNow(caller)),
      ...(latest === undefined
        ? {}
        : {
            operation: machineOperationProjection(
              latest[1].id,
              latest[1].operation,
              this.revision(),
              this.options,
            ),
          }),
    };
  }
  private operationData(
    id: string | undefined,
    operation: OwnedMachineOperation | undefined,
  ): Record<string, unknown> {
    if (id === undefined) throw new RemoteFault('unavailable');
    return { operation: machineOperationProjection(id, operation, this.revision(), this.options) };
  }
  private canControlNow(caller: RemoteCaller): boolean {
    const authority = this.options.captureMachineAuthority?.();
    if (
      authority == null ||
      authority.clientId !== caller.clientId ||
      authority.sessionId !== caller.sessionId ||
      authority.signal.aborted
    )
      return false;
    try {
      authority.assertCurrent();
      return true;
    } catch {
      return false;
    }
  }
  private retireRevokedReceipts(): void {
    // Relay replay admission survives the lease. Retire only fully settled dead callers.
    const dead = new Set<string>();
    const live = new Set<string>();
    for (const [receiptKey, receipt] of this.receipts) {
      const callerKey = receiptKey.slice(0, receiptKey.lastIndexOf('/') + 1);
      if (receipt.operation.authority.signal.aborted && operationIsTerminal(receipt.operation))
        dead.add(callerKey);
      else live.add(callerKey);
    }
    for (const callerKey of dead) {
      if (live.has(callerKey)) continue;
      for (const receiptKey of this.receipts.keys())
        if (receiptKey.startsWith(callerKey)) {
          this.receipts.delete(receiptKey);
          this.operations.delete(receiptKey);
        }
    }
  }
  readonly delivery = (command: string, value: RemoteCommandResult): RemoteCommandResult => {
    if (!MACHINE_COMMANDS.has(command) || !value.ok) return value;
    const source = this.sources.get(value.data);
    if (source === undefined) throw new RemoteFault('unavailable');
    return this.result(source.caller, source.id, source.operation, source.status);
  };
  readonly dispose = (): void => {
    this.disposed = true;
    for (const operation of new Set(this.operations.values())) cancelMachineOperation(operation);
  };
}
function key(caller: RemoteCaller, id: string): string {
  return `${caller.sessionId}/${caller.clientId}/${id}`;
}
function canonical(input: MachineCommand): string {
  return JSON.stringify({
    command: input.command,
    args: Object.fromEntries(Object.entries(input.args).sort(([a], [b]) => a.localeCompare(b))),
  });
}
