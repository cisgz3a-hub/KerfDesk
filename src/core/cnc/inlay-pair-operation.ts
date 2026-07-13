import {
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Polyline,
  type Vec2,
} from '../scene';
import type { CncContourPass, CncGroup, CncPass } from '../job';
import { passNeedsTabs, splitPassForTabs, tabTopZMm } from './cnc-tabs';
import { zPassDepths } from './depth-passes';
import { planStraightInlayPairForSettings, straightInlayPocketDepthMm } from './inlay-pair';

const COORD_EPS = 1e-9;

export type StraightInlayOperation = {
  readonly tool: CncTool;
  readonly femaleSettings: CncLayerSettings;
  readonly maleSettings: CncLayerSettings;
  readonly femalePasses: ReadonlyArray<CncPass>;
  readonly malePasses: ReadonlyArray<CncPass>;
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
): { readonly female: CncGroup; readonly male: CncGroup } | null {
  const operation = compileStraightInlayOperation(polylines, settings, config);
  if (operation === null) return null;
  const female = buildGroup(operation.femaleSettings, operation.tool, operation.femalePasses);
  const male = buildGroup(operation.maleSettings, operation.tool, operation.malePasses);
  return female === null || male === null ? null : { female, male };
}

export function compileStraightInlayOperation(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
): StraightInlayOperation | null {
  if (settings.cutType !== 'inlay-pair') return null;
  const tool = layerCncTool(config, settings);
  const plan = planStraightInlayPairForSettings(polylines, settings, tool);
  if (!plan.ok) return null;
  const femaleSettings: CncLayerSettings = {
    ...settings,
    cutType: 'pocket',
    depthMm: straightInlayPocketDepthMm(settings),
    tabsEnabled: false,
  };
  const maleSettings: CncLayerSettings = { ...settings, cutType: 'profile-outside' };
  return {
    tool,
    femaleSettings,
    maleSettings,
    femalePasses: depthMajorPasses(plan.femaleToolpaths, femaleSettings),
    malePasses: tabbedProfilePasses(plan.maleToolpaths, maleSettings, tool.diameterMm),
  };
}

function depthMajorPasses(
  toolpaths: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
): CncPass[] {
  const passes: CncPass[] = [];
  for (const zMm of zPassDepths(settings.depthMm, settings.depthPerPassMm)) {
    for (const toolpath of toolpaths) passes.push(contourPass(toolpath, zMm));
  }
  return passes;
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

function appendTabPieces(
  passes: CncPass[],
  toolpath: Polyline,
  zMm: number,
  settings: CncLayerSettings,
  toolDiameterMm: number,
): void {
  for (const piece of splitPassForTabs(toolpath, {
    tabWidthMm: settings.tabWidthMm,
    tabsPerShape: settings.tabsPerShape,
    toolDiameterMm,
  })) {
    if (piece.points.length >= 2) passes.push(contourPass(piece, zMm));
  }
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
