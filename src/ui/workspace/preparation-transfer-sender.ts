import type { LargeJobPreparation } from './large-job-preparation';
import type { ToolpathStep } from '../../core/job';
import type { PreparationWorkerResponse } from './preparation-worker-protocol';
import {
  PREPARATION_TRANSFER_STEP_CHUNK,
  type PreparationTransferResponse,
} from './preparation-transfer-protocol';

/** Worker-owned transport: never queues another chunk until the UI accepts it. */
export class PreparationTransferSender {
  private pending: {
    readonly id: number;
    readonly sequence: number;
    readonly resolve: () => void;
  } | null = null;

  constructor(private readonly post: (response: PreparationWorkerResponse) => void) {}

  acceptAcknowledgement(data: unknown): boolean {
    if (
      typeof data !== 'object' ||
      data === null ||
      !('kind' in data) ||
      data.kind !== 'transfer-ack'
    )
      return false;
    const pending = this.pending;
    if (
      pending !== null &&
      'id' in data &&
      data.id === pending.id &&
      'sequence' in data &&
      data.sequence === pending.sequence
    ) {
      this.pending = null;
      pending.resolve();
    }
    // Stale or malformed acknowledgements are never preparation requests.
    return true;
  }

  send(id: number, preparation: LargeJobPreparation): Promise<void> {
    return this.sendPreparation(id, preparation, false);
  }

  /**
   * Consume only a newly constructed worker response, never a shared/cached
   * in-process Preview. Acknowledged slots are released so the worker does
   * not retain its full route while the UI builds another multi-GB copy.
   * Step objects, points, metadata and the prepared Job are never modified.
   */
  sendOwned(id: number, preparation: LargeJobPreparation): Promise<void> {
    return this.sendPreparation(id, preparation, true);
  }

  private async sendPreparation(
    id: number,
    preparation: LargeJobPreparation,
    consume: boolean,
  ): Promise<void> {
    const steps = preparation.toolpath.steps.length;
    const planSteps = preparation.toolpath.executablePlanPreview?.toolpath.steps.length ?? 0;
    if (steps + planSteps <= PREPARATION_TRANSFER_STEP_CHUNK) {
      this.post({ id, kind: 'ok', ...preparation });
      return;
    }
    for (const packet of transferPackets(id, preparation)) {
      if (this.pending !== null) throw new Error('preparation transfer already active');
      await new Promise<void>((resolve, reject) => {
        this.pending = { id, sequence: packet.sequence, resolve };
        try {
          this.post(packet);
        } catch (error) {
          this.pending = null;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      if (consume) releaseAcknowledgedSteps(preparation, packet);
    }
  }
}

function releaseAcknowledgedSteps(
  preparation: LargeJobPreparation,
  packet: PreparationTransferResponse,
): void {
  if (packet.kind !== 'transfer-chunk') return;
  const legacy = preparation.toolpath.steps;
  const plan = preparation.toolpath.executablePlanPreview?.toolpath.steps;
  // Fresh real routes have distinct arrays. If a caller aliases both streams,
  // retain that array until its second stream has also been acknowledged.
  if (packet.route === 'legacy' && legacy === plan) return;
  const steps = packet.route === 'legacy' ? legacy : plan;
  if (steps === undefined) return;
  const owned = steps as Array<ToolpathStep | undefined>;
  owned.fill(undefined, packet.offset, packet.offset + packet.steps.length);
}

function* transferPackets(
  id: number,
  preparation: LargeJobPreparation,
): Generator<PreparationTransferResponse> {
  const { toolpath, ...preparedHeader } = preparation;
  const { steps, executablePlanPreview, ...toolpathHeader } = toolpath;
  const plan = executablePlanPreview?.toolpath;
  const planHeader =
    executablePlanPreview === undefined
      ? undefined
      : (() => {
          const { steps: planSteps, ...planToolpathHeader } = executablePlanPreview.toolpath;
          return {
            ...executablePlanPreview,
            toolpath: planToolpathHeader,
            stepCount: planSteps.length,
          };
        })();
  let sequence = 0;
  yield {
    id,
    sequence,
    kind: 'transfer-start',
    header: {
      ...preparedHeader,
      toolpath: toolpathHeader,
      stepCount: steps.length,
      ...(planHeader === undefined ? {} : { executablePlanPreview: planHeader }),
    },
  };
  for (const [route, routeSteps] of [
    ['legacy', steps],
    ['executable-plan', plan?.steps ?? []],
  ] as const) {
    for (let offset = 0; offset < routeSteps.length; offset += PREPARATION_TRANSFER_STEP_CHUNK) {
      sequence += 1;
      yield {
        id,
        sequence,
        kind: 'transfer-chunk',
        route,
        offset,
        steps: routeSteps.slice(offset, offset + PREPARATION_TRANSFER_STEP_CHUNK),
      };
    }
  }
  yield { id, sequence: sequence + 1, kind: 'transfer-complete' };
}
