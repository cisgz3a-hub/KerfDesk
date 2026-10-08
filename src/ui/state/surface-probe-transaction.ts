import type { ControllerDriver } from '../../core/controllers';
import type { DeviceProfile } from '../../core/devices';
import type { SerialConnection } from '../../platform/types';
import type { SurfaceGridMeasurement } from '../../core/controllers/grbl/surface-grid-probe';
import { startControllerCommand, waitForFreshIdle } from './laser-interactive-command';
import {
  cancelFreshControllerStatusWait,
  waitForFreshControllerStatus,
} from './laser-controller-status-wait';
import {
  continueControllerOperation,
  controllerOperationOwner,
} from './laser-controller-operation';
import type { LaserControllerOperation } from './laser-controller-operation';
import { spindleOffBlockReason } from './laser-probe-policy';
import { failProbeTransaction } from './laser-probe-recovery';
import { PROBE_LINE_TIMEOUT_MS, probeResultFromControllerFailure } from './probe-actions';
import { currentWorkZMm, reportedWorkOffsetMm } from './infer-machine-position';
import { useStore } from './store';
import type { LiveRefs, LaserState } from './laser-store';
import type { SafeWrite } from './laser-safe-write';

export type SurfaceProbeSet = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState>),
) => void;
let nextTransactionId = -1;

/** Reuses the controller arbiter and canonical Abort/recovery; never rewrites work offsets. */
export class SurfaceProbeTransaction {
  readonly driver: ControllerDriver;
  readonly reportInches: boolean;
  readonly sessionEpoch: number;
  readonly modalQuery: string;
  readonly offsetsQuery: string;
  context: Omit<SurfaceGridMeasurement, 'points' | 'complete' | 'measuredAt'> | null = null;
  private readonly connection: SerialConnection;
  private readonly device: DeviceProfile;
  private readonly originVersion: number;
  private readonly positionEpoch: number;
  private readonly operation: Extract<LaserControllerOperation, { readonly kind: 'probe' }>;
  private motionStarted = false;
  private pendingLine = 'surface preflight';

  constructor(
    private readonly set: SurfaceProbeSet,
    private readonly get: () => LaserState,
    private readonly refs: LiveRefs,
    private readonly write: SafeWrite,
  ) {
    if (
      refs.connection === null ||
      refs.controllerCommand !== null ||
      refs.controllerIdleWait !== null ||
      refs.settingsCollector.kind === 'collecting'
    )
      throw new Error('Wait for the current controller exchange before measuring.');
    this.connection = refs.connection;
    this.driver = refs.driver;
    if (
      this.driver.commands.modalStateQuery === null ||
      this.driver.commands.offsetsQuery === null ||
      this.driver.realtime.statusQuery === null
    )
      throw new Error(
        'Surface measurement needs documented modal, offset and realtime status queries.',
      );
    this.modalQuery = this.driver.commands.modalStateQuery;
    this.offsetsQuery = this.driver.commands.offsetsQuery;
    this.device = useStore.getState().project.device;
    this.sessionEpoch = get().controllerSessionEpoch;
    this.originVersion = get().workOriginVersion ?? 0;
    this.positionEpoch = get().trustedPositionEpoch ?? 0;
    this.reportInches = get().controllerSettings?.reportInches === true;
    this.operation = {
      kind: 'probe',
      phase: 'sequence',
      idleReports: 0,
      transactionId: nextTransactionId--,
      affectsXy: false,
    };
  }

  reserve(): void {
    this.set({ probeBusy: true, controllerOperation: this.operation });
  }

  private owns(): boolean {
    const state = this.get();
    return (
      state.connection.kind === 'connected' &&
      this.refs.connection === this.connection &&
      this.refs.driver === this.driver &&
      state.controllerSessionEpoch === this.sessionEpoch &&
      state.controllerOperation !== null &&
      controllerOperationOwner(state.controllerOperation) === this.operation
    );
  }

  assertOwner = (): void => {
    if (!this.owns()) throw new Error('Surface measurement lost controller ownership.');
    this.assertSetup();
    if (this.context !== null) {
      const offset = reportedWorkOffsetMm(this.get().wcoCache, this.reportInches);
      if (offset === null || !sameOffset(offset, this.context.offsetMm))
        throw new Error('Work-coordinate offset changed during surface measurement.');
    }
  };

  private assertSetup(): void {
    const state = this.get();
    if (
      useStore.getState().project.device !== this.device ||
      (state.workOriginVersion ?? 0) !== this.originVersion ||
      (state.trustedPositionEpoch ?? 0) !== this.positionEpoch
    )
      throw new Error('Machine setup or coordinates changed during surface measurement.');
    if (
      state.mpgActive === true ||
      state.positionEvidenceSuppressed ||
      state.reportUnitsUnconfirmed ||
      state.controllerSettings?.reportInches !== this.reportInches
    )
      throw new Error('Machine setup or coordinate units changed during surface measurement.');
  }

  assertSpindleOff(): void {
    const state = this.get();
    const reason = spindleOffBlockReason(state.statusReport?.spindle ?? null, state.accessoryCache);
    if (reason !== null) throw new Error(reason);
  }

  async send(line: string): Promise<ReadonlyArray<string>> {
    this.pendingLine = line;
    this.assertOwner();
    const replies = await startControllerCommand(
      this.refs,
      (data, action, source) => this.write(data, action, source, this.assertOwner),
      {
        kind: 'probe',
        label: 'surface measurement',
        command: `${line}\n`,
        action: 'probe',
        source: this.motionStarted ? 'motion' : 'console',
        timeoutMs: PROBE_LINE_TIMEOUT_MS,
        timeoutMode: 'non-idle-status-activity',
      },
    );
    this.assertOwner();
    return replies;
  }

  async freshPosition(): Promise<{
    readonly offset: { readonly x: number; readonly y: number; readonly z: number };
    readonly z: number;
  }> {
    this.assertOwner();
    const query = this.driver.realtime.statusQuery;
    if (query === null) throw new Error('Live status query is unavailable.');
    const wait = waitForFreshControllerStatus(this.refs, {
      after: { sessionEpoch: this.sessionEpoch, sequence: this.get().statusSequence },
      accept: (report) =>
        report.state === 'Idle' &&
        report.wco !== null &&
        (report.mPos !== null || report.wPos !== null),
      timeoutMs: 15_000,
      timeoutMessage: 'No fresh Idle position with WCO arrived for surface measurement.',
    });
    try {
      await this.write(query, 'probe', 'system', this.assertOwner);
    } catch (error) {
      cancelFreshControllerStatusWait(this.refs, surfaceProbeMessage(error));
      await wait.catch(() => undefined);
      throw error;
    }
    const report = await wait;
    this.assertOwner();
    const offset = reportedWorkOffsetMm(report.wco, this.reportInches);
    const z = currentWorkZMm(report, report.wco, this.reportInches);
    if (offset === null || z === null || !Number.isFinite(z))
      throw new Error('Surface clearance coordinates are not known.');
    if (this.context !== null && !sameOffset(offset, this.context.offsetMm))
      throw new Error('Fresh work offset changed during surface measurement.');
    return { offset, z };
  }

  beginMotion(): void {
    this.assertOwner();
    this.motionStarted = true;
    this.set({
      framedRun: null,
      frameTrace: null,
      frameVerification: null,
    });
  }

  async settle(): Promise<void> {
    this.assertOwner();
    this.set((state) => ({
      controllerOperation: continueControllerOperation(state.controllerOperation, {
        ...this.operation,
        phase: 'awaiting-idle',
      }),
    }));
    await waitForFreshIdle(this.refs, { kind: 'probe', requiredReports: 2 });
    this.assertOwner();
    this.set({ probeBusy: false, controllerOperation: null, lastWriteError: null });
  }

  async fail(error: unknown): Promise<void> {
    if (this.motionStarted)
      await failProbeTransaction(
        this.set,
        this.get,
        this.refs,
        (line, action, source) => this.write(line, action, source),
        this.connection,
        this.operation.transactionId,
        probeResultFromControllerFailure(error, this.pendingLine),
        this.pendingLine,
      );
    else {
      const current = this.get().controllerOperation;
      if (current !== null && controllerOperationOwner(current) === this.operation)
        this.set({ probeBusy: false, controllerOperation: null });
    }
  }
}

function sameOffset(
  a: { readonly x: number; readonly y: number; readonly z: number },
  b: { readonly x: number; readonly y: number; readonly z: number },
): boolean {
  return (
    Math.abs(a.x - b.x) <= 0.003 && Math.abs(a.y - b.y) <= 0.003 && Math.abs(a.z - b.z) <= 0.003
  );
}
export function surfaceProbeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
