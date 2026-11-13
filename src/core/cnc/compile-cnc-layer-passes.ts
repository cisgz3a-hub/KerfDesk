import type { Cnc2dStockEvidence } from './cnc-pocket-stock';
import {
  assertNever,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Polyline,
} from '../scene';
import type { CncPass } from '../job';
import type { CncStrategyFallback } from '../job/cnc-compilation-sidecar-types';
import { settingsWithStockTabGate } from './cnc-tabs';
import { contourMajorPasses, type CncTabHoldFinding } from './cnc-tabbed-contour-passes';
import { cncLayoutCutWidths } from './layout-cut-widths';
import { isProfileCutType, sourceRegionMajorDepthPasses } from './compile-cnc-helpers';
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
import {
  specializedPassesForLayer,
  type SpecializedLayerPasses,
} from './compile-cnc-special-passes';
import {
  manualTabCentersForToolpaths,
  splitLoopTabCounts,
  type CollectedCncContour,
} from './cnc-manual-tab-mapping';
import type { VCarveLadder } from './vcarve-plan';
import { cncSettingsForStage, cncStageRecipe } from './cnc-stage-settings';
import { preserveProfileFinishStages } from './profile-finishing-stage';
import { pocketPassLinks } from './pocket-stay-down-links';

export type CncLayerPassesResult = {
  readonly restStock?: Cnc2dStockEvidence;
  readonly passes: ReadonlyArray<CncPass>;
  readonly offsetFailed: boolean;
  readonly passLimited: boolean;
  readonly stepoverUsed: boolean;
  // Whether the layer's ramp angle shaped these passes' entries. Only the
  // ordinary contour ladder ramps: V-carve, drill and adaptive passes and a
  // helical pocket's passes enter their own way (ADR-273 Amendment 2).
  readonly rampedEntry: boolean;
  // Set when the layer cuts another strategy than it asks for (S8-P2-1).
  readonly strategyFallback?: Omit<CncStrategyFallback, 'layerId'>;
  // Loops whose holding tabs are not the ones set (ADR-258 Amendment 5).
  readonly tabHolds?: ReadonlyArray<CncTabHoldFinding>;
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
  if (specialized.passes !== null) return completePasses(specialized.passes);
  const { strategyFallback } = specialized;
  const adaptiveFallback = strategyFallback === undefined ? {} : { strategyFallback };

  const contours = lineArtContoursForLayer(polylines, settings, tool.diameterMm, sourceContours);
  // The finishing wall and the tab windows ride the same offset as the
  // toolpaths below: the cut width at the full depth (ADR-368 Amendment 2).
  // It is also the shortest path a ramp goes over more than once (ADR-471),
  // and it caps the finish allowance (ADR-140 Amendment 2).
  const cutWidthMm = cncLayoutCutWidths(
    tool,
    settings.depthMm,
    settings.depthPerPassMm,
  ).wallDiameterMm;
  const allowanceMm = profileFinishAllowanceMm(settings, cutWidthMm);
  const raw = rawToolpathsForLayer(polylines, contours, settings, tool, config, allowanceMm);

  const toolpaths = directedToolpaths(raw.toolpaths, settings, handedness);
  const depths = zPassDepths(settings.depthMm, settings.depthPerPassMm);
  // With a finish allowance, a hole too narrow to rough can still be finished
  // down the depth ladder (ADR-140 Amendment 1).
  if ((toolpaths.length === 0 && allowanceMm === 0) || depths.length === 0) {
    // A layer that cuts nothing falls back to nothing either.
    const { strategyFallback: _uncut, ...uncut } = raw;
    return { ...uncut, passes: [], rampedEntry: false };
  }

  const { passes, tabHolds } = passesForDepths(
    polylines,
    contours,
    toolpaths,
    depths,
    settings,
    cutWidthMm,
    allowanceMm,
    handedness,
    sourceContours,
    cncStageRecipe(settings, 'profile-finish', tool) === undefined
      ? undefined
      : cncSettingsForStage(settings, 'profile-finish', tool),
  );
  return {
    ...raw,
    ...adaptiveFallback,
    ...(tabHolds.length === 0 ? {} : { tabHolds }),
    passes:
      settings.rampEntryDeg === undefined || settings.rampEntryDeg <= 0
        ? passes
        : preserveProfileFinishStages(
            passes,
            applyRampEntry(
              passes,
              settings.rampEntryDeg,
              settings.tabsEnabled && isProfileCutType(settings.cutType),
              cutWidthMm,
            ),
          ),
    rampedEntry: rampsContourEntry(settings, passes),
  };
}

function completePasses(passes: ReadonlyArray<CncPass>): CncLayerPassesResult {
  return {
    passes,
    offsetFailed: false,
    passLimited: false,
    stepoverUsed: false,
    rampedEntry: false,
  };
}

// The ramp above descends along contour passes and tabbed profile paths. A
// helical pocket's passes are neither: they keep their own helix, so the
// layer's angle shapes nothing there.
function rampsContourEntry(settings: CncLayerSettings, passes: ReadonlyArray<CncPass>): boolean {
  const rampEntryDeg = settings.rampEntryDeg;
  return (
    rampEntryDeg !== undefined &&
    rampEntryDeg > 0 &&
    passes.some(
      (pass) =>
        (pass.kind === 'contour' && pass.stayDownEntry !== true) ||
        (pass.kind === 'path3d' &&
          pass.stayDownLink !== true &&
          settings.tabsEnabled &&
          isProfileCutType(settings.cutType)),
    )
  );
}

function resolvedSpecializedPasses(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  tool: CncTool,
  handedness: FrameHandedness,
  vcarveLadder?: VCarveLadder,
): SpecializedLayerPasses {
  if (settings.cutType === 'v-carve' && vcarveLadder !== undefined) {
    return { passes: vcarveLadder.passes };
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
      ...(restOperation.strategyFallback === undefined
        ? {}
        : { strategyFallback: restOperation.strategyFallback }),
      ...(restOperation.stockEvidence === undefined
        ? {}
        : { restStock: restOperation.stockEvidence }),
      offsetFailed: restOperation.offsetFailed,
      passLimited: restOperation.passLimited,
      stepoverUsed: restOperation.stepoverUsed,
    };
  }
  return xyToolpathsForCutTypeWithEvidence(contours, settings, tool, allowanceMm);
}

type CncLayerToolpathsResult = {
  readonly restStock?: Cnc2dStockEvidence;
  readonly strategyFallback?: Omit<CncStrategyFallback, 'layerId'>;
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
  finishingSettings?: CncLayerSettings,
): {
  readonly passes: ReadonlyArray<CncPass>;
  readonly tabHolds: ReadonlyArray<CncTabHoldFinding>;
} {
  const helicalPasses = helicalPocketPassesBySourceRegion(
    settings,
    sourcePolylines,
    toolpaths,
    depths,
  );
  if (helicalPasses !== null) {
    return untabbed(pocketPassLinks(helicalPasses, sourcePolylines, settings, wallDiameterMm));
  }

  if (allowanceMm > 0) {
    return untabbed(
      profilePassesWithFinishAllowance(
        contours,
        settings,
        wallDiameterMm,
        toolpaths,
        handedness,
        sourceContours,
        (part, tabCenters) =>
          contourMajorPasses(part, depths, settings, wallDiameterMm, tabCenters).passes,
        finishingSettings,
      ),
    );
  }
  const manualTabCenters = manualTabCentersForToolpaths(toolpaths, sourceContours);
  if (settings.cutType === 'pocket') {
    return untabbed(
      pocketPassLinks(
        sourceRegionMajorDepthPasses(sourcePolylines, toolpaths, depths),
        sourcePolylines,
        settings,
        wallDiameterMm,
      ),
    );
  }
  return contourMajorPasses(
    toolpaths,
    depths,
    settings,
    wallDiameterMm,
    manualTabCenters,
    settings.tabsEnabled
      ? splitLoopTabCounts(toolpaths, sourceContours, settings.tabsPerShape)
      : new Map(),
  );
}

function untabbed(passes: ReadonlyArray<CncPass>) {
  return { passes, tabHolds: [] };
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
