// compileCncJob — Scene + DeviceProfile + CncMachineConfig → Job of CncGroups.
//
// Materialize layer geometry in machine coordinates and order passes safely:
//
//   1. Pockets and engraves first — they never free the part.
//   2. Profiles last, inner contours before outer, so a part is machined
//      completely before the cut that could let it move.
//
// Pure and deterministic: no clock, random input, or I/O.

import { type DeviceProfile, toMachineCoords } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  applyTransform,
  assertNever,
  flattenColoredPathCurves,
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type ColoredPath,
  type Layer,
  type Polyline,
  type Scene,
  type SceneObject,
  type Transform,
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
import { compileStraightInlayGroups } from './inlay-pair-operation';
import { applyRampEntry, enforceCutDirection, parkFields } from './motion-polish';
import { hasFinitePoints, profileToolpathPolylines } from './profile-paths';
import { vcarveClearanceToolpaths } from './vcarve-clearance';
import { specializedPassesForLayer } from './compile-cnc-special-passes';

export function compileCncJob(scene: Scene, device: DeviceProfile, config: CncMachineConfig): Job {
  const clearingGroups: CncGroup[] = [];
  const profileGroups: CncGroup[] = [];
  for (const layer of scene.layers) {
    if (!layer.output) continue;
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    // H.5/H.8: relief objects rough (and optionally finish, with their own
    // bit) as clearing groups — neither ever frees a part.
    clearingGroups.push(
      ...compileReliefGroupsForLayer(scene.objects, layer, settings, device, config),
    );
    const polylines = collectLayerPolylines(scene.objects, layer, device);
    if (polylines.length === 0) continue;
    const inlayGroups = compileStraightInlayGroups(
      polylines,
      settings,
      config,
      (groupSettings, tool, passes) =>
        cncGroupForPasses(layer, groupSettings, tool, passes, device, config),
    );
    if (inlayGroups !== null) {
      clearingGroups.push(inlayGroups.female);
      profileGroups.push(inlayGroups.male);
      continue;
    }
    // H.7 two-stage v-carve clearance runs before the v-bit ladder.
    const clearance = vcarveClearanceGroupForLayer(layer, settings, polylines, device, config);
    if (clearance !== null) clearingGroups.push(clearance);
    const roughing = restPocketRoughingGroupForLayer(layer, settings, polylines, device, config);
    if (roughing !== null) clearingGroups.push(roughing);
    const group = cncGroupForLayer(layer, settings, polylines, device, config);
    if (group === null) continue;
    if (isProfileCutType(settings.cutType)) {
      profileGroups.push(group);
    } else {
      clearingGroups.push(group);
    }
  }
  // H.7 multi-tool: contiguous per-bit sections (one change per bit),
  // profile-carrying sections last so freed parts are never re-machined.
  return { groups: orderGroupsIntoToolSections([...clearingGroups, ...profileGroups]) };
}

export function collectLayerPolylines(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): Polyline[] {
  const out: Polyline[] = [];
  for (const obj of objects) {
    switch (obj.kind) {
      case 'imported-svg':
      case 'text':
      case 'traced-image':
      case 'shape':
        appendObjectPolylines(obj.paths, obj.transform, layer.color, device, out);
        break;
      case 'raster-image':
        // A router has no raster mode; bitmaps are ignored in CNC compile.
        break;
      case 'relief':
        // Relief heightmap toolpaths arrive with H.5 roughing — ignored by
        // the polyline collector by design.
        break;
      default:
        assertNever(obj, 'SceneObject');
    }
  }
  return out;
}

function appendObjectPolylines(
  paths: ReadonlyArray<ColoredPath>,
  transform: Transform,
  layerColor: string,
  device: DeviceProfile,
  out: Polyline[],
): void {
  for (const path of paths) {
    if (path.color !== layerColor) continue;
    const flattened = flattenColoredPathCurves(path, {
      toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
      segmentBudget: 100_000,
    });
    const polylines = flattened.kind === 'ok' ? flattened.polylines : path.polylines;
    for (const polyline of polylines) {
      if (polyline.points.length < 2) continue;
      out.push({
        points: polyline.points.map((p) => toMachineCoords(applyTransform(p, transform), device)),
        closed: polyline.closed,
      });
    }
  }
}

export function cncGroupForLayer(
  layer: Layer,
  settings: CncLayerSettings,
  polylines: ReadonlyArray<Polyline>,
  device: DeviceProfile,
  config: CncMachineConfig,
): CncGroup | null {
  const tool = layerCncTool(config, settings);
  const passes = passesForLayer(polylines, settings, tool, config);
  return cncGroupForPasses(layer, settings, tool, passes, device, config);
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
): ReadonlyArray<CncPass> {
  const specialized = specializedPassesForLayer(polylines, settings, tool);
  if (specialized !== null) return specialized;
  // Finish allowance: roughing toolpaths stay `allowanceMm` proud of the wall
  // (0 for every non-profile cut and for profile cuts without an allowance, so
  // the offset — and therefore the output — is byte-identical to before).
  const allowanceMm = profileFinishAllowanceMm(settings);
  const restOperation = resolveRestPocketOperation(polylines, settings, config);
  if (restOperation.kind === 'error') return [];
  const raw =
    restOperation.kind === 'ok'
      ? restOperation.restToolpaths
      : xyToolpathsForCutType(polylines, settings, tool.diameterMm, allowanceMm);
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
      : contourMajorPasses(toolpaths, depths, settings, tool.diameterMm);
  // One full-depth finishing pass at the true contour, appended after roughing.
  const passes =
    allowanceMm > 0
      ? [...roughing, ...finishingProfilePasses(polylines, settings, tool.diameterMm)]
      : roughing;
  // H.9 (opt-in): plunges become along-path ramps at the configured angle.
  return settings.rampEntryDeg === undefined
    ? passes
    : applyRampEntry(passes, settings.rampEntryDeg);
}

// The finish allowance in effect for this layer: the stock-to-leave value, but
// only for the two side-offset profile cut types it applies to. Pocket,
// profile-on-path, v-carve, drill, engrave, and relief are out of scope (0).
function profileFinishAllowanceMm(settings: CncLayerSettings): number {
  const applies = settings.cutType === 'profile-outside' || settings.cutType === 'profile-inside';
  const allowance = settings.finishAllowanceMm ?? 0;
  return applies && Number.isFinite(allowance) && allowance > 0 ? allowance : 0;
}

// The finishing pass: one loop along the TRUE contour (tool-radius offset, no
// allowance) at full depth. When tabs are on it is tab-split through the SAME
// splitPassForTabs the deepest roughing pass uses, so the finishing pass still
// leaves the holding tabs and the part stays attached.
function finishingProfilePasses(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  toolDiameterMm: number,
): CncPass[] {
  const side = settings.cutType === 'profile-inside' ? 'inside' : 'outside';
  const raw = orderInnerFirst(profileToolpathPolylines(polylines, side, toolDiameterMm));
  const toolpaths =
    settings.cutDirection === undefined
      ? raw
      : enforceCutDirection(raw, settings.cutDirection, settings.cutType);
  const zMm = -settings.depthMm;
  const wantsTabs = settings.tabsEnabled;
  const passes: CncPass[] = [];
  for (const toolpath of toolpaths) {
    if (
      wantsTabs &&
      toolpath.closed &&
      passNeedsTabs(zMm, settings.depthMm, settings.tabHeightMm)
    ) {
      appendTabbedPasses(passes, toolpath, zMm, settings, toolDiameterMm);
    } else {
      passes.push(contourPassFromPolyline(toolpath, zMm));
    }
  }
  return passes;
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
        appendTabbedPasses(passes, toolpath, zMm, settings, toolDiameterMm);
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
): void {
  for (const piece of splitPassForTabs(toolpath, {
    tabWidthMm: settings.tabWidthMm,
    tabsPerShape: settings.tabsPerShape,
    toolDiameterMm,
  })) {
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
