import {
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Polyline,
} from '../scene';
import { cncLayoutCutWidths } from './layout-cut-widths';
import type { PocketToolpaths } from './pocket-paths';
import { pocketToolpathsForSettingsWithEvidence } from './cnc-pocket-toolpaths';
export {
  pocketToolpathsForSettings,
  pocketToolpathsForSettingsWithEvidence,
} from './cnc-pocket-toolpaths';
import { resolveStockAwareRestPocket } from './cnc-rest-stock-operation';
import type { Cnc2dStockEvidence } from './cnc-pocket-stock';
import { planRestPocketToolpaths } from './rest-pocket';

export type CncRestPocketPlanningEvidence = {
  readonly offsetFailed: boolean;
  readonly passLimited: boolean;
  readonly stepoverUsed: boolean;
};

export type CncRestPocketOperation =
  | { readonly kind: 'not-requested' }
  | ({ readonly kind: 'error'; readonly reason: string } & CncRestPocketPlanningEvidence)
  | ({
      readonly kind: 'ok';
      readonly stockEvidence?: Cnc2dStockEvidence;
      readonly findings?: ReadonlyArray<string>;
      readonly roughTool: CncTool;
      readonly finishTool: CncTool;
      readonly roughToolpaths: ReadonlyArray<Polyline>;
      readonly restToolpaths: ReadonlyArray<Polyline>;
      readonly roughingOffsetFailed: boolean;
      readonly roughingPassLimited: boolean;
      // Natural exhaustion is complete; geometry failure and a fixed pass
      // budget are advisory incomplete-output states.
      readonly completion: 'complete' | 'geometry-failed' | 'pass-limit';
    } & CncRestPocketPlanningEvidence);

const NO_REST_POCKET_EVIDENCE: CncRestPocketPlanningEvidence = {
  offsetFailed: false,
  passLimited: false,
  stepoverUsed: false,
};

export function resolveRestPocketOperation(
  contours: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
): CncRestPocketOperation {
  if (settings.cutType !== 'pocket') {
    return { kind: 'not-requested' };
  }
  if (settings.pocketRestStock !== undefined)
    return resolveStockAwareRestPocket(contours, settings, config);
  if (settings.pocketRoughToolId === undefined || settings.pocketStrategy === 'adaptive')
    return { kind: 'not-requested' };
  if (settings.helixEntry !== undefined) {
    return restPocketError('Rest machining and helical entry cannot be combined yet.');
  }
  const roughTool = resolveRoughTool(config, settings.pocketRoughToolId);
  if (roughTool.kind === 'error') return roughTool;
  const finishTool = layerCncTool(config, settings);
  const finishWidths = cncLayoutCutWidths(finishTool, settings.depthMm, settings.depthPerPassMm);
  const rest = planRestPocketToolpaths(
    contours,
    roughTool.diameterMm,
    finishWidths.wallDiameterMm,
    settings.stepoverPercent,
    finishWidths.clearingDiameterMm,
  );
  if (!rest.ok) return restPocketError(rest.reason);
  const roughing = pocketToolpathsForSettingsWithEvidence(contours, settings, roughTool);
  if (roughing.toolpaths.length === 0) {
    return emptyRoughingPocketError(roughing, rest.stepoverUsed);
  }
  return {
    kind: 'ok',
    roughTool,
    finishTool,
    roughToolpaths: roughing.toolpaths,
    restToolpaths: rest.toolpaths,
    roughingOffsetFailed: roughing.offsetFailed,
    roughingPassLimited: roughing.passLimited,
    offsetFailed: rest.completion === 'geometry-failed' || roughing.offsetFailed,
    passLimited: rest.completion === 'pass-limit' || roughing.passLimited,
    stepoverUsed: rest.stepoverUsed || roughing.stepoverUsed,
    completion: rest.completion,
  };
}

function restPocketError(
  reason: string,
  evidence: CncRestPocketPlanningEvidence = NO_REST_POCKET_EVIDENCE,
): Extract<CncRestPocketOperation, { readonly kind: 'error' }> {
  return { kind: 'error', reason, ...evidence };
}

function emptyRoughingPocketError(
  roughing: PocketToolpaths,
  restStepoverUsed: boolean,
): Extract<CncRestPocketOperation, { readonly kind: 'error' }> {
  const reason = roughing.offsetFailed
    ? 'Pocket roughing geometry could not be calculated safely.'
    : 'The roughing bit does not fit this pocket.';
  return restPocketError(reason, {
    offsetFailed: roughing.offsetFailed,
    passLimited: roughing.passLimited,
    stepoverUsed: restStepoverUsed || roughing.stepoverUsed,
  });
}

function resolveRoughTool(
  config: CncMachineConfig,
  toolId: string,
): CncTool | Extract<CncRestPocketOperation, { readonly kind: 'error' }> {
  const tool = config.tools.find((candidate) => candidate.id === toolId);
  if (tool === undefined) return restPocketError('The selected pocket roughing bit is missing.');
  return tool.kind === 'end-mill'
    ? tool
    : restPocketError(`Pocket roughing requires a flat end mill; "${tool.name}" is ${tool.kind}.`);
}
