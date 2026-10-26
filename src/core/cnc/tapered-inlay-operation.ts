import {
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Polyline,
} from '../scene';
import type { CncGroup, CncPass } from '../job';
import { zPassDepths, zPassStepMm } from './depth-passes';
import { planTaperedInlayPair } from './tapered-inlay';
import { taperedInlayPlugDepth } from './tapered-inlay-settings';
import { vcarveMedialPasses } from './vcarve-medial';
import type { StraightInlayGroupsCompilation } from './inlay-pair-operation';
import type { VCarveLadder } from './vcarve-plan';

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
  const male = startDepthPlugPasses(
    plan.maleWasteContours,
    plan.plugWallStartDepthMm,
    taperedInlayPlugDepth(intent),
    tool,
    settings,
  );
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

/**
 * The plug as a start-depth V-carve of its waste (ADR-665): every tool tip sits `startDepthMm`
 * lower, down to the plug depth, so the cone cuts the mirrored design exactly as far in as the
 * pocket wall plus the fit gap. Every level is that one carve, no deeper than its first wall
 * level, stepped down from the stock top by the depth per pass until it reaches the start depth;
 * the wall levels follow. One plan keeps the floor ridges of every level aligned, so no level
 * cuts deeper than the depth per pass.
 */
function startDepthPlugPasses(
  waste: ReadonlyArray<Polyline>,
  startDepthMm: number,
  plugDepthMm: number,
  tool: CncTool,
  settings: CncLayerSettings,
): VCarveLadder {
  const wallDepthMm = plugDepthMm - startDepthMm;
  const carve = vcarveMedialPasses(waste, {
    tool,
    maxDepthMm: wallDepthMm,
    depthPerPassMm: wallDepthMm,
    resolutionMm: settings.vResolutionMm,
  });
  const perPass = settings.depthPerPassMm;
  const wallLevels = zPassDepths(wallDepthMm, perPass).map((levelZ) => ({
    startMm: startDepthMm,
    depthMm: -levelZ,
  }));
  const firstWallLevelMm = zPassStepMm(wallDepthMm, perPass);
  const roughStarts =
    startDepthMm + firstWallLevelMm <= zPassStepMm(plugDepthMm, perPass) + 0.000001
      ? []
      : [
          0,
          ...zPassDepths(startDepthMm, perPass)
            .slice(0, -1)
            .map((levelZ) => -levelZ),
        ];
  const levels = [
    ...roughStarts.map((startMm) => ({ startMm, depthMm: firstWallLevelMm })),
    ...wallLevels,
  ];
  return {
    ...carve,
    passes: levels.flatMap(({ startMm, depthMm }) =>
      offsetStartingPlane(passesNoDeeperThan(carve.passes, depthMm), startMm),
    ),
  };
}

function passesNoDeeperThan(
  passes: ReadonlyArray<CncPass>,
  depthMm: number,
): ReadonlyArray<CncPass> {
  const floor = (z: number) => Math.max(z, -depthMm);
  return passes.map((pass): CncPass => {
    switch (pass.kind) {
      case 'path3d':
        return { ...pass, points: pass.points.map((point) => ({ ...point, z: floor(point.z) })) };
      case 'helical-contour':
        return { ...pass, startZMm: floor(pass.startZMm), zMm: floor(pass.zMm) };
      case 'contour':
      case 'arc':
        return { ...pass, zMm: floor(pass.zMm) };
    }
  });
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
