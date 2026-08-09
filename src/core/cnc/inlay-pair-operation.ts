import {
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Polyline,
  type Vec2,
} from '../scene';
import type { CncContourPass, CncGroup, CncPass } from '../job';
import { passNeedsTabs, tabTopZMm } from './cnc-tabs';
import { tabRampedPoints } from './cnc-tab-ramp';
import { sourceRegionMajorDepthPasses } from './compile-cnc-helpers';
import { zPassDepths } from './depth-passes';
import {
  planStraightInlayPairForSettings,
  straightInlayPocketDepthMm,
  type StraightInlayPairPlanningEvidence,
} from './inlay-pair';
import { orderInnerFirst } from './profile-ordering';

const COORD_EPS = 1e-9;

export type StraightInlayOperation = {
  readonly tool: CncTool;
  readonly femaleSettings: CncLayerSettings;
  readonly maleSettings: CncLayerSettings;
  readonly femalePocketOffsetFailed: boolean;
  readonly femalePocketPassLimited: boolean;
  readonly stepoverUsed: boolean;
  readonly femalePasses: ReadonlyArray<CncPass>;
  readonly malePasses: ReadonlyArray<CncPass>;
};

export type StraightInlayGroupsCompilation = StraightInlayPairPlanningEvidence & {
  readonly groups: { readonly female: CncGroup; readonly male: CncGroup } | null;
};

const NO_INLAY_PLANNING_EVIDENCE: StraightInlayPairPlanningEvidence = {
  femalePocketOffsetFailed: false,
  femalePocketPassLimited: false,
  stepoverUsed: false,
};

export function compileStraightInlayGroups(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
  buildGroup: (
    groupSettings: CncLayerSettings,
    tool: CncTool,
    passes: ReadonlyArray<CncPass>,
  ) => CncGroup | null,
): {
  readonly female: CncGroup;
  readonly male: CncGroup;
  readonly femalePocketPassLimited: boolean;
} | null {
  const compiled = compileStraightInlayGroupsWithEvidence(polylines, settings, config, buildGroup);
  return compiled === null || compiled.groups === null
    ? null
    : {
        ...compiled.groups,
        femalePocketPassLimited: compiled.femalePocketPassLimited,
      };
}

export function compileStraightInlayGroupsWithEvidence(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
  buildGroup: (
    groupSettings: CncLayerSettings,
    tool: CncTool,
    passes: ReadonlyArray<CncPass>,
  ) => CncGroup | null,
): StraightInlayGroupsCompilation | null {
  if (settings.cutType !== 'inlay-pair') return null;
  const compiled = compileStraightInlayOperationWithEvidence(polylines, settings, config);
  const operation = compiled.operation;
  if (operation === null) return { groups: null, ...compiled.evidence };
  const female = buildGroup(operation.femaleSettings, operation.tool, operation.femalePasses);
  const male = buildGroup(operation.maleSettings, operation.tool, operation.malePasses);
  return {
    groups: female === null || male === null ? null : { female, male },
    ...compiled.evidence,
  };
}

export function compileStraightInlayOperation(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
): StraightInlayOperation | null {
  return compileStraightInlayOperationWithEvidence(polylines, settings, config).operation;
}

type StraightInlayOperationCompilation = {
  readonly operation: StraightInlayOperation | null;
  readonly evidence: StraightInlayPairPlanningEvidence;
};

function compileStraightInlayOperationWithEvidence(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
): StraightInlayOperationCompilation {
  if (settings.cutType !== 'inlay-pair') {
    return { operation: null, evidence: NO_INLAY_PLANNING_EVIDENCE };
  }
  const tool = layerCncTool(config, settings);
  const plan = planStraightInlayPairForSettings(polylines, settings, tool);
  const evidence: StraightInlayPairPlanningEvidence = {
    femalePocketOffsetFailed: plan.femalePocketOffsetFailed,
    femalePocketPassLimited: plan.femalePocketPassLimited,
    stepoverUsed: plan.stepoverUsed,
  };
  if (!plan.ok) return { operation: null, evidence };
  const femaleSettings: CncLayerSettings = {
    ...settings,
    cutType: 'pocket',
    depthMm: straightInlayPocketDepthMm(settings),
    tabsEnabled: false,
  };
  const maleSettings: CncLayerSettings = { ...settings, cutType: 'profile-outside' };
  return {
    operation: {
      tool,
      femaleSettings,
      maleSettings,
      ...evidence,
      femalePasses: sourceRegionMajorDepthPasses(
        polylines,
        plan.femaleToolpaths,
        zPassDepths(femaleSettings.depthMm, femaleSettings.depthPerPassMm),
      ),
      malePasses: tabbedProfilePasses(
        orderInnerFirst(plan.maleToolpaths),
        maleSettings,
        tool.diameterMm,
      ),
    },
    evidence,
  };
}

function tabbedProfilePasses(
  toolpaths: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  toolDiameterMm: number,
): CncPass[] {
  const depths = profileDepths(settings);
  const passes: CncPass[] = [];
  for (const toolpath of toolpaths) {
    for (const zMm of depths) {
      if (settings.tabsEnabled && passNeedsTabs(zMm, settings.depthMm, settings.tabHeightMm)) {
        appendTabPieces(passes, toolpath, zMm, settings, toolDiameterMm);
      } else {
        passes.push(contourPass(toolpath, zMm));
      }
    }
  }
  return passes;
}

function profileDepths(settings: CncLayerSettings): ReadonlyArray<number> {
  const depths = zPassDepths(settings.depthMm, settings.depthPerPassMm);
  if (!settings.tabsEnabled) return depths;
  const tabTop = tabTopZMm(settings.depthMm, settings.tabHeightMm);
  if (tabTop >= -COORD_EPS || tabTop <= -settings.depthMm + COORD_EPS) return depths;
  if (depths.some((zMm) => Math.abs(zMm - tabTop) <= COORD_EPS)) return depths;
  return [...depths, tabTop].sort((a, b) => b - a);
}

// ADR-258: one continuous Z-rise path, matching the profile and finishing paths.
// Leaving this on the split model would mix both tab models inside a single job.
function appendTabPieces(
  passes: CncPass[],
  toolpath: Polyline,
  zMm: number,
  settings: CncLayerSettings,
  toolDiameterMm: number,
): void {
  const points = tabRampedPoints(toolpath, zMm, tabTopZMm(settings.depthMm, settings.tabHeightMm), {
    tabWidthMm: settings.tabWidthMm,
    tabsPerShape: settings.tabsPerShape,
    toolDiameterMm,
  });
  if (points !== null && points.length >= 2) {
    passes.push({ kind: 'path3d', points, closed: false });
    return;
  }
  if (toolpath.points.length >= 2) passes.push(contourPass(toolpath, zMm));
}

function contourPass(polyline: Polyline, zMm: number): CncContourPass {
  return { kind: 'contour', zMm, polyline: closedPoints(polyline), closed: polyline.closed };
}

function closedPoints(polyline: Polyline): ReadonlyArray<Vec2> {
  const first = polyline.points[0];
  const last = polyline.points[polyline.points.length - 1];
  if (!polyline.closed || first === undefined || last === undefined) return polyline.points;
  const closed = Math.abs(first.x - last.x) <= COORD_EPS && Math.abs(first.y - last.y) <= COORD_EPS;
  return closed ? polyline.points : [...polyline.points, first];
}
