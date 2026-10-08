import {
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type Polyline,
} from '../scene';
import type { CncGroup, CncPass } from '../job';
import { planTaperedInlayPair } from './tapered-inlay';
import { taperedInlayPlugDepth } from './tapered-inlay-settings';
import { vcarveMedialPasses } from './vcarve-medial';
import type { StraightInlayGroupsCompilation } from './inlay-pair-operation';
import type { VCarveLadder } from './vcarve-ladder';

export type TaperedInlayOperation = {
  readonly femaleSettings: CncLayerSettings;
  readonly maleSettings: CncLayerSettings;
  readonly femalePasses: ReadonlyArray<CncPass>;
  readonly malePasses: ReadonlyArray<CncPass>;
  readonly findings: ReadonlyArray<string>;
  readonly offsetFailed: boolean;
  readonly passLimited: boolean;
};

export function compileTaperedInlayOperation(
  contours: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
  directionX: 1 | -1 = 1,
): {
  readonly operation: TaperedInlayOperation | null;
  readonly findings: ReadonlyArray<string>;
  readonly offsetFailed: boolean;
} {
  const intent = settings.taperedInlay;
  if (intent === undefined || settings.cutType !== 'inlay-pair')
    return { operation: null, findings: [], offsetFailed: false };
  const tool = layerCncTool(config, settings);
  const plan = planTaperedInlayPair(contours, intent, tool, directionX);
  if (!plan.ok)
    return { operation: null, findings: [plan.reason], offsetFailed: plan.offsetFailed };
  const female = vcarveMedialPasses(plan.femaleContours, {
    tool,
    maxDepthMm: intent.pocketDepthMm,
    depthPerPassMm: settings.depthPerPassMm,
    resolutionMm: settings.vResolutionMm,
  });
  const male = vcarveMedialPasses(plan.maleWasteContours, {
    tool,
    maxDepthMm: taperedInlayPlugDepth(intent),
    depthPerPassMm: settings.depthPerPassMm,
    resolutionMm: settings.vResolutionMm,
  });
  const findings = [
    ...plan.findings,
    ...ladderFindings(female, 'Pocket'),
    ...ladderFindings(male, 'Plug'),
  ];
  const operation = {
    femaleSettings: pieceSettings(settings, intent.pocketStartDepthMm + intent.pocketDepthMm),
    maleSettings: pieceSettings(settings, intent.plugStartDepthMm + taperedInlayPlugDepth(intent)),
    femalePasses: offsetStartingPlane(female.passes, intent.pocketStartDepthMm),
    malePasses: offsetStartingPlane(male.passes, intent.plugStartDepthMm),
    findings,
    offsetFailed: female.offsetFailed || male.offsetFailed,
    passLimited: female.passLimited || male.passLimited || female.thinResidual || male.thinResidual,
  };
  return { operation, findings, offsetFailed: operation.offsetFailed };
}

export function compileTaperedInlayGroups(
  contours: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
  buildGroup: (
    settings: CncLayerSettings,
    passes: ReadonlyArray<CncPass>,
    piece: 'pocket' | 'plug',
  ) => CncGroup | null,
  directionX: 1 | -1 = 1,
): StraightInlayGroupsCompilation {
  const result = compileTaperedInlayOperation(contours, settings, config, directionX);
  const operation = result.operation;
  if (operation === null)
    return {
      groups: null,
      femalePocketOffsetFailed: result.offsetFailed,
      femalePocketPassLimited: false,
      stepoverUsed: false,
    };
  const female = buildGroup(operation.femaleSettings, operation.femalePasses, 'pocket');
  const male = buildGroup(operation.maleSettings, operation.malePasses, 'plug');
  return {
    groups: female === null || male === null ? null : { female, male },
    femalePocketOffsetFailed: operation.offsetFailed,
    femalePocketPassLimited: operation.passLimited,
    stepoverUsed: false,
  };
}

function pieceSettings(settings: CncLayerSettings, depthMm: number): CncLayerSettings {
  return {
    ...settings,
    cutType: 'v-carve',
    depthMm,
    vCarveFlatDepthEnabled: true,
    tabsEnabled: false,
  };
}

function ladderFindings(ladder: VCarveLadder, name: string): ReadonlyArray<string> {
  const findings: string[] = [];
  if (ladder.offsetFailed)
    findings.push(`${name} V-carve offset failed; inspect incomplete output.`);
  if (ladder.passLimited || ladder.thinResidual)
    findings.push(
      `${name} V-carve cannot cover every requested detail at the represented precision or planning budget.`,
    );
  if (ladder.entryIssue !== null) findings.push(`${name}: ${ladder.entryIssue}`);
  return findings;
}

export function offsetStartingPlane(
  passes: ReadonlyArray<CncPass>,
  depthMm: number,
): ReadonlyArray<CncPass> {
  if (depthMm === 0) return passes;
  return passes.map((pass): CncPass => {
    switch (pass.kind) {
      case 'path3d':
        return {
          ...pass,
          points: pass.points.map((point) => ({ ...point, z: point.z - depthMm })),
        };
      case 'helical-contour':
        return { ...pass, startZMm: pass.startZMm - depthMm, zMm: pass.zMm - depthMm };
      case 'contour':
      case 'arc':
        return { ...pass, zMm: pass.zMm - depthMm };
    }
  });
}
