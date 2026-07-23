// compileCncJob — Scene + DeviceProfile + CncMachineConfig → Job of CncGroups.
//
// Materialize layer geometry in machine coordinates and order passes safely:
//
//   1. Pockets and engraves first — they never free the part.
//   2. Profiles last, inner contours before outer, so a part is machined
//      completely before the cut that could let it move.
//
// Pure and deterministic: no clock, random input, or I/O.

import { machineBoundsForDevice, type DeviceProfile } from '../devices';
import { artworkOperationRuns } from '../artwork-order';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  assertNever,
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Layer,
  type Polyline,
  type Scene,
} from '../scene';
import type { CncGroup, CncPass, Job } from '../job';
import { passNeedsTabs, splitPassForTabs, tabTopZMm } from './cnc-tabs';
import { coolantFields } from './coolant-fields';
import {
  capFeed,
  capSpindle,
  contourPassFromPolyline,
  isProfileCutType,
  orderInnerFirst,
} from './compile-cnc-helpers';
import { compileReliefGroupsForLayer } from './compile-cnc-relief';
import { orderGroupsIntoToolSections } from './cnc-tool-sections';
import { pocketToolpathsForSettings, resolveRestPocketOperation } from './cnc-rest-operation';
import { zPassDepths } from './depth-passes';
import { planHelicalPocketPasses } from './helical-entry';
import { finishingProfilePasses, profileFinishAllowanceMm } from './finish-allowance';
import { compileStraightInlayGroups } from './inlay-pair-operation';
import {
  DEFAULT_LINE_ART_CONTOURS,
  lineArtSelectionApplies,
  selectLineArtContours,
} from './line-art-contours';
import { applyRampEntry, enforceCutDirection, parkFields } from './motion-polish';
import { applyProfileLeadPasses } from './profile-lead-passes';
import { hasFinitePoints, profileToolpathPolylines } from './profile-paths';
import { vcarveClearanceToolpaths } from './vcarve-clearance';
import { specializedPassesForLayer } from './compile-cnc-special-passes';
import { collectLayerContours } from './collect-cnc-contours';
import { manualTabCentersForToolpaths, type CollectedCncContour } from './cnc-manual-tab-mapping';

export function compileCncJob(scene: Scene, device: DeviceProfile, config: CncMachineConfig): Job {
  const clearingGroups: CncGroup[] = [];
  const profileGroups: CncGroup[] = [];
  const sourceObjects = scene.objects;
  for (const { layer, priorityObjectId } of artworkOperationRuns(scene)) {
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    // H.5/H.8: relief objects rough (and optionally finish, with their own
    // bit) as clearing groups — neither ever frees a part.
    clearingGroups.push(
      ...compileReliefGroupsForLayer(sourceObjects, layer, settings, device, config).map((group) =>
        tagArtworkGroup(group, priorityObjectId),
      ),
    );
    const contours = collectLayerContours(sourceObjects, layer, device);
    const polylines = contours.map((contour) => contour.polyline);
    if (polylines.length === 0) continue;
    const inlayGroups = compileStraightInlayGroups(
      polylines,
      settings,
      config,
      (groupSettings, tool, passes) =>
        cncGroupForPasses(layer, groupSettings, tool, passes, device, config),
    );
    if (inlayGroups !== null) {
      clearingGroups.push(tagArtworkGroup(inlayGroups.female, priorityObjectId));
      profileGroups.push(tagArtworkGroup(inlayGroups.male, priorityObjectId));
      continue;
    }
    // H.7 two-stage v-carve clearance runs before the v-bit ladder.
    const clearance = vcarveClearanceGroupForLayer(layer, settings, polylines, device, config);
    if (clearance !== null) clearingGroups.push(tagArtworkGroup(clearance, priorityObjectId));
    const roughing = restPocketRoughingGroupForLayer(layer, settings, polylines, device, config);
    if (roughing !== null) clearingGroups.push(tagArtworkGroup(roughing, priorityObjectId));
    const group = cncGroupForLayer(layer, settings, polylines, device, config, contours);
    if (group === null) continue;
    if (isProfileCutType(settings.cutType)) {
      profileGroups.push(tagArtworkGroup(group, priorityObjectId));
    } else {
      clearingGroups.push(tagArtworkGroup(group, priorityObjectId));
    }
  }
  // H.7 multi-tool: contiguous per-bit sections (one change per bit),
  // profile-carrying sections last so freed parts are never re-machined.
  return { groups: orderGroupsIntoToolSections([...clearingGroups, ...profileGroups]) };
}

function tagArtworkGroup(group: CncGroup, sourceObjectId: string): CncGroup {
  return { ...group, sourceObjectId };
}

export { collectLayerPolylines } from './collect-cnc-contours';

export function cncGroupForLayer(
  layer: Layer,
  settings: CncLayerSettings,
  polylines: ReadonlyArray<Polyline>,
  device: DeviceProfile,
  config: CncMachineConfig,
  tabSources?: ReadonlyArray<CollectedCncContour>,
): CncGroup | null {
  const tool = layerCncTool(config, settings);
  const passes = passesForLayer(polylines, settings, tool, config, tabSources);
  // ADR-250: bake profile lead-in/out into closed profile passes (default-on
  // for profile-outside/inside; a no-op for other cut types and shape 'none').
  const led = applyProfileLeadPasses(
    passes,
    settings,
    tool.diameterMm,
    machineBoundsForDevice(device),
  );
  return cncGroupForPasses(layer, settings, tool, led, device, config);
}

function restPocketRoughingGroupForLayer(
  layer: Layer,
  settings: CncLayerSettings,
  polylines: ReadonlyArray<Polyline>,
  device: DeviceProfile,
  config: CncMachineConfig,
): CncGroup | null {
  const operation = resolveRestPocketOperation(polylines, settings, config);
  if (operation.kind !== 'ok') return null;
  const depths = zPassDepths(settings.depthMm, settings.depthPerPassMm);
  let passes: ReadonlyArray<CncPass> = depthMajorPasses(operation.roughToolpaths, depths);
  if (settings.rampEntryDeg !== undefined) passes = applyRampEntry(passes, settings.rampEntryDeg);
  return cncGroupForPasses(layer, settings, operation.roughTool, passes, device, config);
}

function cncGroupForPasses(
  layer: Layer,
  settings: CncLayerSettings,
  tool: CncTool,
  passes: ReadonlyArray<CncPass>,
  device: DeviceProfile,
  config: CncMachineConfig,
): CncGroup | null {
  if (passes.length === 0) return null;
  const cutFeed =
    settings.cutType === 'drill'
      ? Math.min(settings.feedMmPerMin, settings.plungeMmPerMin)
      : settings.feedMmPerMin;
  return {
    kind: 'cnc',
    layerId: layer.id,
    color: layer.color,
    cutType: settings.cutType,
    toolId: tool.id,
    toolName: tool.name,
    toolDiameterMm: tool.diameterMm,
    feedMmPerMin: capFeed(cutFeed, device.maxFeed),
    plungeMmPerMin: capFeed(settings.plungeMmPerMin, device.maxFeed),
    spindleRpm: capSpindle(settings.spindleRpm, config.params.spindleMaxRpm),
    spindleSpinupSec: Math.max(0, config.params.spindleSpinupSec),
    ...coolantFields(config),
    safeZMm: Math.max(0, config.params.safeZMm),
    ...parkFields(config),
    passes,
  };
}

// The two-stage v-carve's clearing group (H.7): pocket the flat floors
// with the layer's clearing bit before the v-bit ladder runs.
export function vcarveClearanceGroupForLayer(
  layer: Layer,
  settings: CncLayerSettings,
  polylines: ReadonlyArray<Polyline>,
  device: DeviceProfile,
  config: CncMachineConfig,
): CncGroup | null {
  if (settings.cutType !== 'v-carve' || settings.vClearToolId === undefined) return null;
  const clearTool = config.tools.find((tool) => tool.id === settings.vClearToolId);
  if (clearTool === undefined) return null;
  const vBit = layerCncTool(config, settings);
  const toolpaths = vcarveClearanceToolpaths(polylines, {
    vBit,
    clearTool,
    maxDepthMm: settings.depthMm,
    stepoverPercent: settings.stepoverPercent,
  });
  const depths = zPassDepths(settings.depthMm, settings.depthPerPassMm);
  if (toolpaths.length === 0 || depths.length === 0) return null;
  return {
    kind: 'cnc',
    layerId: layer.id,
    color: layer.color,
    cutType: 'pocket',
    toolId: clearTool.id,
    toolName: clearTool.name,
    toolDiameterMm: clearTool.diameterMm,
    feedMmPerMin: capFeed(settings.feedMmPerMin, device.maxFeed),
    plungeMmPerMin: capFeed(settings.plungeMmPerMin, device.maxFeed),
    spindleRpm: capSpindle(settings.spindleRpm, config.params.spindleMaxRpm),
    spindleSpinupSec: Math.max(0, config.params.spindleSpinupSec),
    ...coolantFields(config),
    safeZMm: Math.max(0, config.params.safeZMm),
    ...parkFields(config),
    passes: depthMajorPasses(toolpaths, depths),
  };
}

function passesForLayer(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  tool: CncTool,
  config: CncMachineConfig,
  tabSources: ReadonlyArray<CollectedCncContour> = [],
): ReadonlyArray<CncPass> {
  const specialized = specializedPassesForLayer(polylines, settings, tool);
  if (specialized !== null) return specialized;
  const contours = lineArtContoursForLayer(polylines, settings, tool.diameterMm);
  // Finish allowance: roughing toolpaths stay `allowanceMm` proud of the wall
  // (0 for every non-profile cut and for profile cuts without an allowance, so
  // the offset — and therefore the output — is byte-identical to before).
  const allowanceMm = profileFinishAllowanceMm(settings);
  const restOperation = resolveRestPocketOperation(polylines, settings, config);
  if (restOperation.kind === 'error') return [];
  const raw =
    restOperation.kind === 'ok'
      ? restOperation.restToolpaths
      : xyToolpathsForCutType(contours, settings, tool.diameterMm, allowanceMm);
  // H.9 (opt-in): climb/conventional enforcement + mid-segment entry points.
  const toolpaths =
    settings.cutDirection === undefined
      ? raw
      : enforceCutDirection(raw, settings.cutDirection, settings.cutType);
  const depths = zPassDepths(settings.depthMm, settings.depthPerPassMm);
  if (toolpaths.length === 0 || depths.length === 0) return [];
  const helicalPasses = helicalPocketPasses(settings, toolpaths, depths);
  if (helicalPasses !== null) return helicalPasses;
  const roughing =
    settings.cutType === 'pocket'
      ? depthMajorPasses(toolpaths, depths)
      : contourMajorPasses(
          toolpaths,
          depths,
          settings,
          tool.diameterMm,
          manualTabCentersForToolpaths(toolpaths, tabSources),
        );
  // One full-depth finishing pass at the true contour, appended after roughing.
  const passes =
    allowanceMm > 0
      ? [
          ...roughing,
          ...finishingProfilePasses(contours, settings, tool.diameterMm, toolpaths, tabSources),
        ]
      : roughing;
  // H.9 (opt-in): plunges become along-path ramps at the configured angle.
  return settings.rampEntryDeg === undefined
    ? passes
    : applyRampEntry(passes, settings.rampEntryDeg);
}

// ADR-218: pick which edge of a traced double-line ring is machined BEFORE
// any offsetting, so the surviving contour offsets as a lone shape. Only
// edge-following cut types select; pocket reaches passesForLayer too but its
// toolpaths come from resolveRestPocketOperation / pocketToolpathsForSettings
// on the unfiltered contours (a ring's band needs both edges).
function lineArtContoursForLayer(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  toolDiameterMm: number,
): ReadonlyArray<Polyline> {
  if (!lineArtSelectionApplies(settings.cutType)) return polylines;
  return selectLineArtContours(
    polylines,
    settings.lineArtContours ?? DEFAULT_LINE_ART_CONTOURS,
    toolDiameterMm,
  );
}

function helicalPocketPasses(
  settings: CncLayerSettings,
  toolpaths: ReadonlyArray<Polyline>,
  depths: ReadonlyArray<number>,
): ReadonlyArray<CncPass> | null {
  if (settings.cutType !== 'pocket' || settings.helixEntry === undefined) return null;
  if (settings.pocketStrategy === 'raster-x' || settings.pocketStrategy === 'raster-y') return [];
  const plan = planHelicalPocketPasses(toolpaths, depths, settings.helixEntry);
  return plan.ok ? plan.passes : [];
}

export function xyToolpathsForCutType(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  toolDiameterMm: number,
  allowanceMm: number,
): ReadonlyArray<Polyline> {
  switch (settings.cutType) {
    case 'profile-outside':
      return orderInnerFirst(
        profileToolpathPolylines(polylines, 'outside', toolDiameterMm, allowanceMm),
      );
    case 'profile-inside':
      return orderInnerFirst(
        profileToolpathPolylines(polylines, 'inside', toolDiameterMm, allowanceMm),
      );
    case 'profile-on-path':
      return orderInnerFirst(profileToolpathPolylines(polylines, 'on-path', toolDiameterMm));
    case 'pocket':
      return pocketToolpathsForSettings(polylines, settings, toolDiameterMm);
    case 'engrave':
      // Same non-finite guard as every other cut type: a NaN vertex would
      // otherwise survive to the emitter as a literal "G1 XNaN" that the
      // digit-based preflight word parser cannot see.
      return polylines.filter(
        (polyline) => polyline.points.length >= 2 && hasFinitePoints(polyline),
      );
    case 'v-carve':
    case 'inlay-pair':
    case 'drill':
      // Handled by their dedicated branches upstream — unreachable here.
      return [];
    case 'relief-rough':
    case 'relief-finish':
      // Compile-time-only cut types (produced by compile-cnc-relief from
      // relief objects) — a layer can never carry them.
      return [];
    default:
      return assertNever(settings.cutType, 'CncCutType');
  }
}

// Complete each contour to full depth before moving to the next (fewer
// re-entries per shape; matches how Easel carves profiles). Tab splitting
// applies to the deep passes of closed profile contours only.
function contourMajorPasses(
  toolpaths: ReadonlyArray<Polyline>,
  depths: ReadonlyArray<number>,
  settings: CncLayerSettings,
  toolDiameterMm: number,
  manualTabCenters: ReadonlyMap<Polyline, ReadonlyArray<number>> = new Map(),
): CncPass[] {
  const wantsTabs = settings.tabsEnabled && isProfileCutType(settings.cutType);
  // Tabbed loops need a full-loop pass at EXACTLY the tab top: otherwise tab
  // height quantizes up to the pass grid, and a single-pass through-cut
  // never cuts the tab windows at all (full-stock-thickness "tabs").
  const tabbedDepths = wantsTabs ? depthsWithTabTopPass(depths, settings) : depths;
  const passes: CncPass[] = [];
  for (const toolpath of toolpaths) {
    const ladder = wantsTabs && toolpath.closed ? tabbedDepths : depths;
    for (const zMm of ladder) {
      const needsTabs =
        wantsTabs && toolpath.closed && passNeedsTabs(zMm, settings.depthMm, settings.tabHeightMm);
      if (needsTabs) {
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

function depthsWithTabTopPass(
  depths: ReadonlyArray<number>,
  settings: CncLayerSettings,
): ReadonlyArray<number> {
  const tabTop = tabTopZMm(settings.depthMm, settings.tabHeightMm);
  // Degenerate tab heights (0, or >= depth) leave the ladder untouched.
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
  for (const piece of splitPassForTabs(
    toolpath,
    {
      tabWidthMm: settings.tabWidthMm,
      tabsPerShape: settings.tabsPerShape,
      toolDiameterMm,
    },
    manualCenters,
  )) {
    if (piece.points.length >= 2) passes.push(contourPassFromPolyline(piece, zMm));
  }
}

// Clear every ring at one depth before stepping down — pockets remove the
// floor level by level.
function depthMajorPasses(
  toolpaths: ReadonlyArray<Polyline>,
  depths: ReadonlyArray<number>,
): CncPass[] {
  const passes: CncPass[] = [];
  for (const zMm of depths) {
    for (const toolpath of toolpaths) {
      passes.push(contourPassFromPolyline(toolpath, zMm));
    }
  }
  return passes;
}
