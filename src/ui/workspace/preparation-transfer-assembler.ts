import type { ToolpathStep } from '../../core/job';
import type { LargeJobPreparation } from './large-job-preparation';
import { PreparationStepRehydrator } from './preparation-step-rehydrator';
import {
  PREPARATION_TRANSFER_STEP_CHUNK,
  type PreparationTransferResponse,
} from './preparation-transfer-protocol';

/** Partial routes stay private until every expected step has arrived in order. */
export class PreparationTransferAssembler {
  private readonly legacy: ToolpathStep[];
  private readonly plan: ToolpathStep[];
  private receivedLegacy = 0;
  private receivedPlan = 0;
  private nextSequence = 1;
  private readonly rehydrator = new PreparationStepRehydrator();

  constructor(
    private readonly start: Extract<
      PreparationTransferResponse,
      { readonly kind: 'transfer-start' }
    >,
  ) {
    const counts = [start.header.stepCount, start.header.executablePlanPreview?.stepCount ?? 0];
    if (
      start.sequence !== 0 ||
      counts.some((count) => !Number.isSafeInteger(count) || count < 0 || count > 0xffffffff)
    ) {
      throw new Error('invalid preparation transfer header');
    }
    // The exact sizes are known. Fill private arrays by cursor, avoiding
    // repeated growing-array copies while millions of raster steps arrive.
    this.legacy = new Array<ToolpathStep>(start.header.stepCount);
    this.plan = new Array<ToolpathStep>(start.header.executablePlanPreview?.stepCount ?? 0);
  }

  accept(
    packet: Exclude<PreparationTransferResponse, { readonly kind: 'transfer-start' }>,
  ): LargeJobPreparation | null {
    if (packet.id !== this.start.id || packet.sequence !== this.nextSequence)
      throw new Error('out-of-order preparation transfer');
    if (packet.kind === 'transfer-chunk') {
      this.appendChunk(packet);
      this.nextSequence += 1;
      return null;
    }
    const result = this.complete();
    this.nextSequence += 1;
    return result;
  }

  private appendChunk(
    packet: Extract<PreparationTransferResponse, { readonly kind: 'transfer-chunk' }>,
  ): void {
    const route = this.receivedLegacy < this.legacy.length ? 'legacy' : 'executable-plan';
    const target = packet.route === 'legacy' ? this.legacy : this.plan;
    const received = packet.route === 'legacy' ? this.receivedLegacy : this.receivedPlan;
    if (
      packet.route !== route ||
      packet.offset !== received ||
      packet.steps.length === 0 ||
      packet.steps.length > PREPARATION_TRANSFER_STEP_CHUNK ||
      received + packet.steps.length > target.length
    ) {
      throw new Error('invalid preparation transfer chunk');
    }
    let cursor = received;
    for (const step of packet.steps) target[cursor++] = this.rehydrator.rehydrate(step);
    if (packet.route === 'legacy') this.receivedLegacy += packet.steps.length;
    else this.receivedPlan += packet.steps.length;
  }

  private complete(): LargeJobPreparation {
    if (this.receivedLegacy !== this.legacy.length || this.receivedPlan !== this.plan.length)
      throw new Error('incomplete preparation transfer');
    const {
      toolpath,
      stepCount: _stepCount,
      executablePlanPreview,
      ...preparation
    } = this.start.header;
    const planRoute =
      executablePlanPreview === undefined
        ? undefined
        : (() => {
            const {
              toolpath: planToolpath,
              stepCount: _planCount,
              ...planMetadata
            } = executablePlanPreview;
            return { ...planMetadata, toolpath: { ...planToolpath, steps: this.plan } };
          })();
    return {
      ...preparation,
      toolpath: {
        ...toolpath,
        steps: this.legacy,
        ...(planRoute === undefined ? {} : { executablePlanPreview: planRoute }),
      },
    };
  }
}
