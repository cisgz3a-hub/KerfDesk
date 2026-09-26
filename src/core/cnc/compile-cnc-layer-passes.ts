import {
  assertNever,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Polyline,
} from '../scene';
import type { CncPass } from '../job';
import { passNeedsTabs, settingsWithStockTabGate, tabTopZMm } from './cnc-tabs';
import { tabRampedPoints } from './cnc-tab-ramp';
import { cncLayoutCutWidths } from './layout-cut-widths';
import {
  contourPassFromPolyline,
  isProfileCutType,
  sourceRegionMajorDepthPasses,
} from './compile-cnc-helpers';
import { orderInnerFirst } from './profile-ordering';
import {
  pocketToolpathsForSettingsWithEvidence,
  resolveRestPocketOperation,
} from './cnc-rest-operation';
import { zPassDepths } from './depth-passes';
import { helicalPocketPassesBySourceRegion } from './cnc-helical-pocket-passes';
import { profileFinishAllowanceMm, profilePassesWithFinishAllowance } from './finish-allowance';
import {
  DEFAULT_LINE_ART_CONTOURS,
  lineArtPairableSet,
  lineArtSelectionApplies,
  selectLineArtContours,
} from './line-art-contours';
import type { FrameHandedness } from './machine-frame-handedness';
import { applyRampEntry, enforceCutDirection } from './motion-polish';
import { hasFinitePoints, profileToolpathPolylines } from './profile-paths';
import { specializedPassesForLayer } from './compile-cnc-special-passes';
import { manualTabCentersForToolpaths, type CollectedCncContour } from './cnc-manual-tab-mapping';
import type { VCarveLadder } from './vcarve-ladder';

export function passesForCncLayer(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  tool: CncTool,
  config: CncMachineConfig,
  handedness: FrameHandedness,
  sourceContours: ReadonlyArray<CollectedCncContour> = [],
  vcarveLadder?: VCarveLadder,
): ReadonlyArray<CncPass> {
  return passesForCncLayerWithEvidence(
    polylines,
    settings,
    tool,
    config,
    handedness,
    sourceContours,
    vcarveLadder,
  ).passes;
}

export type CncLayerPassesResult = {
  readonly passes: ReadonlyArray<CncPass>;
  readonly offsetFailed: boolean;
  readonly passLimited: boolean;
  readonly stepoverUsed: boolean;
};

export function passesForCncLayerWithEvidence(
  polylines: ReadonlyArray<Polyline>,
  layerSettings: CncLayerSettings,
  tool: CncTool,
  config: CncMachineConfig,
  handedness: FrameHandedness,
  sourceContours: ReadonlyArray<CollectedCncContour> = [],
  vcarveLadder?: VCarveLadder,
): CncLayerPassesResult {
  // ADR-258 amendment 1: no tabs where the floor under the cut holds the part.
  const settings = settingsWithStockTabGate(layerSettings, config.stock.thicknessMm);
  const specialized = resolvedSpecializedPasses(
    polylines,
    settings,
    tool,
    handedness,
    vcarveLadder,
  );
  if (specialized !== null) return completePasses(specialized);

  const contours = lineArtContoursForLayer(polylines, settings, tool.diameterMm, sourceContours);
  const allowanceMm = profileFinishAllowanceMm(settings);
  const raw = rawToolpathsForLayer(polylines, contours, settings, tool, config, allowanceMm);

  const toolpaths = directedToolpaths(raw.toolpaths, settings, handedness);
  const depths = zPassDepths(settings.depthMm, settings.depthPerPassMm);
  if (toolpaths.length === 0 || depths.length === 0) {
    return { ...raw, passes: [] };
  }

  // The finishing wall and the tab windows ride the same offset as the
  // toolpaths above: the cut width at the full depth (ADR-368 Amendment 2).
  const passes = passesForDepths(
    polylines,
    contours,
    toolpaths,
    depths,
    settings,
    cncLayoutCutWidths(tool, settings.depthMm, settings.depthPerPassMm).wallDiameterMm,
    allowanceMm,
    handedness,
    sourceContours,
  );
  return {
    ...raw,
    passes:
      settings.rampEntryDeg === undefined || settings.rampEntryDeg <= 0
        ? passes
        : applyRampEntry(
            passes,
            settings.rampEntryDeg,
            settings.tabsEnabled && isProfileCutType(settings.cutType),
          ),
  };
}

function completePasses(passes: ReadonlyArray<CncPass>): CncLayerPassesResult {
  return { passes, offsetFailed: false, passLimited: false, stepoverUsed: false };
}

function resolvedSpecializedPasses(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  tool: CncTool,
  handedness: FrameHandedness,
  vcarveLadder?: VCarveLadder,
): ReadonlyArray<CncPass> | null {
  if (settings.cutType === 'v-carve' && vcarveLadder !== undefined) {
    return vcarveLadder.passes;
  }
  return specializedPassesForLayer(polylines, settings, tool, handedness);
}

function rawToolpathsForLayer(
  sourcePolylines: ReadonlyArray<Polyline>,
  contours: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  tool: CncTool,
  config: CncMachineConfig,
  allowanceMm: number,
): CncLayerToolpathsResult {
  const restOperation = resolveRestPocketOperation(sourcePolylines, settings, config);
  if (restOperation.kind === 'error') {
    return {
      toolpaths: [],
      offsetFailed: restOperation.offsetFailed,
      passLimited: restOperation.passLimited,
      stepoverUsed: restOperation.stepoverUsed,
    };
  }
  if (restOperation.kind === 'ok') {
    return {
      toolpaths: restOperation.restToolpaths,
      offsetFailed: restOperation.offsetFailed,
      passLimited: restOperation.passLimited,
      stepoverUsed: restOperation.stepoverUsed,
    };
  }
  return xyToolpathsForCutTypeWithEvidence(contours, settings, tool, allowanceMm);
}

type CncLayerToolpathsResult = {
  readonly toolpaths: ReadonlyArray<Polyline>;
  readonly offsetFailed: boolean;
  readonly passLimited: boolean;
  readonly stepoverUsed: boolean;
};

function directedToolpaths(
  toolpaths: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  handedness: FrameHandedness,
): ReadonlyArray<Polyline> {
  return settings.cutDirection === undefined
    ? toolpaths
    : enforceCutDirection(toolpaths, settings.cutDirection, settings.cutType, handedness);
}

function passesForDepths(
  sourcePolylines: ReadonlyArray<Polyline>,
  contours: ReadonlyArray<Polyline>,
  toolpaths: ReadonlyArray<Polyline>,
  depths: ReadonlyArray<number>,
  settings: CncLayerSettings,
  wallDiameterMm: number,
  allowanceMm: number,
  handedness: FrameHandedness,
  sourceContours: ReadonlyArray<CollectedCncContour>,
): ReadonlyArray<CncPass> {
  const helicalPasses = helicalPocketPassesBySourceRegion(
    settings,
    sourcePolylines,
    toolpaths,
    depths,
  );
  if (helicalPasses !== null) return helicalPasses;

  const manualTabCenters = manualTabCentersForToolpaths(toolpaths, sourceContours);
  if (allowanceMm > 0) {
    return profilePassesWithFinishAllowance(
      contours,
      settings,
      wallDiameterMm,
      toolpaths,
      handedness,
      sourceContours,
      (part) => contourMajorPasses(part, depths, settings, wallDiameterMm, manualTabCenters),
    );
  }
  if (settings.cutType === 'pocket') {
    return sourceRegionMajorDepthPasses(sourcePolylines, toolpaths, depths);
  }
  return contourMajorPasses(toolpaths, depths, settings, wallDiameterMm, manualTabCenters);
}

// ADR-218: select the surviving edge of a traced double-line ring before
// offsetting. Pairing remains provenance-scoped (ADR-277). The minimum-feature
// check (ADR-433) reads the same selection.
export function lineArtContoursForLayer(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  toolDiameterMm: number,
  sourceContours: ReadonlyArray<CollectedCncContour> = [],
): ReadonlyArray<Polyline> {
  if (!lineArtSelectionApplies(settings.cutType)) return polylines;
  return selectLineArtContours(
    polylines,
    settings.lineArtContours ?? DEFAULT_LINE_ART_CONTOURS,
    toolDiameterMm,
    lineArtPairableSet(sourceContours),
  );
}

export function xyToolpathsForCutType(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  tool: CncTool,
  allowanceMm: number,
): ReadonlyArray<Polyline> {
  return xyToolpathsForCutTypeWithEvidence(polylines, settings, tool, allowanceMm).toolpaths;
}

// Side-offset profiles offset by the cut width at the full depth, which is the
// stored diameter for every bit except a tapered ball nose (ADR-368
// Amendment 2); pockets derive their own widths from the same settings.
export function xyToolpathsForCutTypeWithEvidence(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  tool: CncTool,
  allowanceMm: number,
): CncLayerToolpathsResult {
  const wallMm = cncLayoutCutWidths(tool, settings.depthMm, settings.depthPerPassMm).wallDiameterMm;
  switch (settings.cutType) {
    case 'profile-outside':
      return completeToolpaths(
        orderInnerFirst(profileToolpathPolylines(polylines, 'outside', wallMm, allowanceMm)),
      );
    case 'profile-inside':
      return completeToolpaths(
        orderInnerFirst(profileToolpathPolylines(polylines, 'inside', wallMm, allowanceMm)),
      );
    case 'profile-on-path':
      return completeToolpaths(
        orderInnerFirst(profileToolpathPolylines(polylines, 'on-path', tool.diameterMm)),
      );
    case 'pocket':
      return pocketToolpathsForSettingsWithEvidence(polylines, settings, tool);
    case 'engrave':
      return completeToolpaths(
        polylines.filter((polyline) => polyline.points.length >= 2 && hasFinitePoints(polyline)),
      );
    case 'v-carve':
    case 'inlay-pair':
    case 'drill':
    case 'relief-rough':
    case 'relief-finish':
      return completeToolpaths([]);
    default:
      return assertNever(settings.cutType, 'CncCutType');
  }
}

function completeToolpaths(toolpaths: ReadonlyArray<Polyline>): CncLayerToolpathsResult {
  return { toolpaths, offsetFailed: false, passLimited: false, stepoverUsed: false };
}

function contourMajorPasses(
  toolpaths: ReadonlyArray<Polyline>,
  depths: ReadonlyArray<number>,
  settings: CncLayerSettings,
  toolDiameterMm: number,
  manualTabCenters: ReadonlyMap<Polyline, ReadonlyArray<number>> = new Map(),
): CncPass[] {
  const wantsTabs = settings.tabsEnabled && isProfileCutType(settings.cutType);
  const tabbedDepths = wantsTabs ? depthsWithTabTopPass(depths, settings) : depths;
  const passes: CncPass[] = [];
  for (const toolpath of toolpaths) {
    const ladder = wantsTabs && toolpath.closed ? tabbedDepths : depths;
    for (const zMm of ladder) {
      if (passNeedsTabsForContour(wantsTabs, toolpath, zMm, settings)) {
        appendTabbedPasses(
          passes,
          toolpath,
          zMm,
          settings,
          toolDiameterMm,
          manualTabCenters.get(toolpath),
        );
      } else {
        passes.push(contourPassFromPolyline(toolpath, zMm));
      }
    }
  }
  return passes;
}

function passNeedsTabsForContour(
  wantsTabs: boolean,
  toolpath: Polyline,
  zMm: number,
  settings: CncLayerSettings,
): boolean {
  return wantsTabs && toolpath.closed && passNeedsTabs(zMm, settings.depthMm, settings.tabHeightMm);
}

function depthsWithTabTopPass(
  depths: ReadonlyArray<number>,
  settings: CncLayerSettings,
): ReadonlyArray<number> {
  const tabTop = tabTopZMm(settings.depthMm, settings.tabHeightMm);
  if (tabTop >= -1e-9 || tabTop <= -settings.depthMm + 1e-9) return depths;
  if (depths.some((z) => Math.abs(z - tabTop) <= 1e-9)) return depths;
  return [...depths, tabTop].sort((a, b) => b - a);
}

function appendTabbedPasses(
  passes: CncPass[],
  toolpath: Polyline,
  zMm: number,
  settings: CncLayerSettings,
  toolDiameterMm: number,
  manualCenters?: ReadonlyArray<number>,
): void {
  const points = tabRampedPoints(
    toolpath,
    zMm,
    tabTopZMm(settings.depthMm, settings.tabHeightMm),
    {
      tabWidthMm: settings.tabWidthMm,
      tabsPerShape: settings.tabsPerShape,
      toolDiameterMm,
    },
    manualCenters,
  );
  if (points === null || points.length < 2) {
    passes.push(contourPassFromPolyline(toolpath, zMm));
    return;
  }
  passes.push({ kind: 'path3d', points, closed: false });
}
