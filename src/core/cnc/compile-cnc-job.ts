// compileCncJob — Scene + DeviceProfile + CncMachineConfig → Job of CncGroups.
//
// The CNC analog of compile-job.ts. Walks every output-enabled layer,
// materializes its polylines in machine coordinates, converts them into XY
// toolpaths for the layer's cut type (tool-radius profile offsets, pocket
// clearing rings, on-path engraves), and expands depth passes (with holding
// tabs on deep profile passes). Emission order is safety-driven:
//
//   1. Pockets and engraves first — they never free the part.
//   2. Profiles last, inner contours before outer, so a part is machined
//      completely before the cut that could let it move.
//
// Pure: no clock, no random, no I/O. Deterministic: indexed loops and
// stable sorts only.

import { type DeviceProfile, toMachineCoords } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  activeCncTool,
  applyTransform,
  assertNever,
  type CncCutType,
  type CncLayerSettings,
  type CncMachineConfig,
  type ColoredPath,
  type Layer,
  type Polyline,
  type Scene,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../scene';
import type { CncGroup, CncPass, Job } from '../job';
import { passNeedsTabs, splitPassForTabs } from './cnc-tabs';
import { compileReliefGroupForLayer } from './compile-cnc-relief';
import { zPassDepths } from './depth-passes';
import { pocketToolpathRings } from './pocket-paths';
import { profileToolpathPolylines } from './profile-paths';
import { vcarvePasses } from './vcarve-ladder';

const COORD_EPS = 1e-9;
const MIN_FEED_MM_PER_MIN = 1;

export function compileCncJob(scene: Scene, device: DeviceProfile, config: CncMachineConfig): Job {
  const clearingGroups: CncGroup[] = [];
  const profileGroups: CncGroup[] = [];
  for (const layer of scene.layers) {
    if (!layer.output) continue;
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    // H.5: relief objects on this layer rough as their own clearing group
    // (waterline slices never free a part).
    const reliefGroup = compileReliefGroupForLayer(scene.objects, layer, settings, device, config);
    if (reliefGroup !== null) clearingGroups.push(reliefGroup);
    const polylines = collectLayerPolylines(scene.objects, layer, device);
    if (polylines.length === 0) continue;
    const group = cncGroupForLayer(layer, settings, polylines, device, config);
    if (group === null) continue;
    if (isProfileCutType(settings.cutType)) {
      profileGroups.push(group);
    } else {
      clearingGroups.push(group);
    }
  }
  return { groups: [...clearingGroups, ...profileGroups] };
}

export function isProfileCutType(cutType: CncCutType): boolean {
  return (
    cutType === 'profile-outside' || cutType === 'profile-inside' || cutType === 'profile-on-path'
  );
}

function collectLayerPolylines(
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
    for (const polyline of path.polylines) {
      if (polyline.points.length < 2) continue;
      out.push({
        points: polyline.points.map((p) => toMachineCoords(applyTransform(p, transform), device)),
        closed: polyline.closed,
      });
    }
  }
}

function cncGroupForLayer(
  layer: Layer,
  settings: CncLayerSettings,
  polylines: ReadonlyArray<Polyline>,
  device: DeviceProfile,
  config: CncMachineConfig,
): CncGroup | null {
  const tool = activeCncTool(config);
  const passes = passesForLayer(polylines, settings, tool);
  if (passes.length === 0) return null;
  return {
    kind: 'cnc',
    layerId: layer.id,
    color: layer.color,
    cutType: settings.cutType,
    toolDiameterMm: tool.diameterMm,
    feedMmPerMin: capFeed(settings.feedMmPerMin, device.maxFeed),
    plungeMmPerMin: capFeed(settings.plungeMmPerMin, device.maxFeed),
    spindleRpm: capSpindle(settings.spindleRpm, config.params.spindleMaxRpm),
    spindleSpinupSec: Math.max(0, config.params.spindleSpinupSec),
    safeZMm: Math.max(0, config.params.safeZMm),
    passes,
  };
}

function passesForLayer(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  tool: ReturnType<typeof activeCncTool>,
): ReadonlyArray<CncPass> {
  // V-carve computes per-ring depths itself (H.3) — it does not fit the
  // "XY toolpaths × uniform depth ladder" shape of the other cut types.
  if (settings.cutType === 'v-carve') {
    return vcarvePasses(polylines, {
      tool,
      maxDepthMm: settings.depthMm,
      depthPerPassMm: settings.depthPerPassMm,
      resolutionMm: settings.vResolutionMm,
    });
  }
  const toolpaths = xyToolpathsForCutType(polylines, settings, tool.diameterMm);
  const depths = zPassDepths(settings.depthMm, settings.depthPerPassMm);
  if (toolpaths.length === 0 || depths.length === 0) return [];
  return settings.cutType === 'pocket'
    ? depthMajorPasses(toolpaths, depths)
    : contourMajorPasses(toolpaths, depths, settings, tool.diameterMm);
}

function xyToolpathsForCutType(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  toolDiameterMm: number,
): ReadonlyArray<Polyline> {
  switch (settings.cutType) {
    case 'profile-outside':
      return orderInnerFirst(profileToolpathPolylines(polylines, 'outside', toolDiameterMm));
    case 'profile-inside':
      return orderInnerFirst(profileToolpathPolylines(polylines, 'inside', toolDiameterMm));
    case 'profile-on-path':
      return orderInnerFirst(profileToolpathPolylines(polylines, 'on-path', toolDiameterMm));
    case 'pocket':
      return pocketToolpathRings(polylines, toolDiameterMm, settings.stepoverPercent);
    case 'engrave':
      return polylines.filter((polyline) => polyline.points.length >= 2);
    case 'v-carve':
      // Handled by the vcarvePasses branch upstream — unreachable here.
      return [];
    case 'relief-rough':
      // Compile-time-only cut type (produced by compile-cnc-relief from
      // relief objects) — a layer can never carry it.
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
  const passes: CncPass[] = [];
  for (const toolpath of toolpaths) {
    for (const zMm of depths) {
      const needsTabs =
        wantsTabs && toolpath.closed && passNeedsTabs(zMm, settings.depthMm, settings.tabHeightMm);
      if (needsTabs) {
        appendTabbedPasses(passes, toolpath, zMm, settings, toolDiameterMm);
      } else {
        passes.push(passFromPolyline(toolpath, zMm));
      }
    }
  }
  return passes;
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
    if (piece.points.length >= 2) passes.push(passFromPolyline(piece, zMm));
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
      passes.push(passFromPolyline(toolpath, zMm));
    }
  }
  return passes;
}

function passFromPolyline(polyline: Polyline, zMm: number): CncPass {
  return { kind: 'contour', zMm, polyline: ensureRingClosure(polyline), closed: polyline.closed };
}

// Job convention (job.ts CutSegment): a closed pass's polyline ends where it
// starts. Source polylines are not guaranteed to duplicate the first point.
function ensureRingClosure(polyline: Polyline): ReadonlyArray<Vec2> {
  const { points, closed } = polyline;
  if (!closed || points.length < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return points;
  const alreadyClosed =
    Math.abs(first.x - last.x) <= COORD_EPS && Math.abs(first.y - last.y) <= COORD_EPS;
  return alreadyClosed ? points : [...points, first];
}

// Inner contours before outer ones: cutting a hole after freeing the part
// that contains it machines a workpiece that can move.
function orderInnerFirst(polylines: ReadonlyArray<Polyline>): ReadonlyArray<Polyline> {
  const closedPolylines = polylines.filter(
    (polyline) => polyline.closed && polyline.points.length >= 3,
  );
  return polylines
    .map((polyline, index) => ({
      polyline,
      index,
      depth: containmentDepth(polyline, closedPolylines),
    }))
    .sort((a, b) => b.depth - a.depth || a.index - b.index)
    .map((entry) => entry.polyline);
}

function containmentDepth(polyline: Polyline, closed: ReadonlyArray<Polyline>): number {
  const probe = polyline.points[0];
  if (probe === undefined) return 0;
  let depth = 0;
  for (const candidate of closed) {
    if (candidate === polyline) continue;
    if (pointInPolygon(probe, candidate.points)) depth += 1;
  }
  return depth;
}

function pointInPolygon(point: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    const crossesY = a.y > point.y !== b.y > point.y;
    if (!crossesY) continue;
    const xAtY = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}

function capFeed(feedMmPerMin: number, maxFeed: number): number {
  if (!Number.isFinite(feedMmPerMin) || feedMmPerMin <= 0) return MIN_FEED_MM_PER_MIN;
  return Math.min(feedMmPerMin, maxFeed);
}

function capSpindle(spindleRpm: number, spindleMaxRpm: number): number {
  if (!Number.isFinite(spindleRpm) || spindleRpm <= 0) return 0;
  return Math.min(spindleRpm, spindleMaxRpm);
}
