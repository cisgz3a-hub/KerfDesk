import type { CncPass } from '../job';
import type { CncLayerSettings, Polyline, Vec2 } from '../scene';
import { passNeedsTabs, tabTopZMm } from './cnc-tabs';
import { tabRampedPoints } from './cnc-tab-ramp';
import { manualTabCentersForToolpaths, type CollectedCncContour } from './cnc-manual-tab-mapping';
import { roughingReach } from './finish-allowance-coverage';
import { bucketFinishAllowanceParts } from './finish-allowance-part-buckets';
import { roughingTabCentersBesideFinishTabs } from './finish-allowance-tabs';
import type { FrameHandedness } from './machine-frame-handedness';
import { enforceCutDirection } from './motion-polish';
import { groupInnerFirstByPart, orderInnerFirst } from './profile-ordering';
import { profileToolpathPolylines } from './profile-paths';
import { zPassDepths } from './depth-passes';
import { profileFinishStagePass } from './profile-finishing-stage';

const COORD_EPS = 1e-9;

// Stock-to-leave applies only to side-offset profiles. Other cut types keep
// their existing toolpaths and do not receive a finishing contour.
//
// ADR-140 Amendment 2: the allowance cut is at most the cutter radius. At one
// cut width the roughing slot no longer meets the finishing slot, and the ring
// of stock between them is left standing free. From the radius up the "skin" is
// half the cutter or more, so the finishing pass steps down (finishingDepths).
export function profileFinishAllowanceMm(settings: CncLayerSettings, cutWidthMm: number): number {
  const applies = settings.cutType === 'profile-outside' || settings.cutType === 'profile-inside';
  const allowance = settings.finishAllowanceMm ?? 0;
  if (!applies || !Number.isFinite(allowance) || !(allowance > 0)) return 0;
  return cutWidthMm > 0 ? Math.min(allowance, cutWidthMm / 2) : allowance;
}

/** True when the allowance is cut as the cutter radius: half the cutter in stock. */
export function finishAllowanceReachesRadius(
  settings: CncLayerSettings,
  cutWidthMm: number,
): boolean {
  const allowance = profileFinishAllowanceMm(settings, cutWidthMm);
  return allowance > 0 && allowance >= cutWidthMm / 2 - COORD_EPS;
}

/** Complete roughing and the true-wall finish for one part before the next. */
export function profilePassesWithFinishAllowance(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  toolDiameterMm: number,
  roughingToolpaths: ReadonlyArray<Polyline>,
  handedness: FrameHandedness,
  tabSources: ReadonlyArray<CollectedCncContour>,
  roughingPassesForPart: RoughingPassesForPart,
  finishingSettings?: CncLayerSettings,
): ReadonlyArray<CncPass> {
  const sourceParts = groupInnerFirstByPart(polylines);
  const roughParts = groupInnerFirstByPart(roughingToolpaths);
  const finishToolpaths = finishingProfileToolpaths(
    polylines,
    settings,
    toolDiameterMm,
    handedness,
  );
  const finishParts = groupInnerFirstByPart(finishToolpaths);
  const roughBySource = bucketFinishAllowanceParts(sourceParts, roughParts);
  const finishBySource = bucketFinishAllowanceParts(sourceParts, finishParts);
  const manualTabCenters = manualTabCentersForToolpaths(finishToolpaths, tabSources);
  // ADR-140 Amendment 2: one tab plan. The finishing rings keep the bridges the
  // layer has without an allowance, and every roughing ring, a ring merged
  // around several parts included, rises beside each of them.
  const roughTabCenters = settings.tabsEnabled
    ? roughingTabCentersBesideFinishTabs(
        finishToolpaths,
        roughingToolpaths,
        settings.tabsPerShape,
        manualTabCenters,
        manualTabCentersForToolpaths(roughingToolpaths, tabSources),
        toolDiameterMm,
      )
    : new Map<Polyline, ReadonlyArray<number>>();
  const passes: CncPass[] = [];
  for (let index = 0; index < sourceParts.length; index += 1) {
    const sourceRough = roughBySource.buckets[index]?.flat() ?? [];
    const sourceFinish = finishBySource.buckets[index]?.flat() ?? [];
    passes.push(
      ...roughingPassesForPart(sourceRough, roughTabCenters),
      ...finishingPasses(sourceFinish, -settings.depthMm, {
        settings,
        toolDiameterMm,
        roughingToolpaths: sourceRough,
        manualTabCenters,
        ...(finishingSettings === undefined ? {} : { finishingSettings }),
      }),
    );
  }
  appendUnassignedParts(
    passes,
    roughBySource.unassigned,
    finishBySource.unassigned,
    settings,
    toolDiameterMm,
    manualTabCenters,
    roughTabCenters,
    roughingPassesForPart,
    finishingSettings,
  );
  return passes;
}

type RoughingPassesForPart = (
  part: ReadonlyArray<Polyline>,
  tabCenters: ReadonlyMap<Polyline, ReadonlyArray<number>>,
) => ReadonlyArray<CncPass>;

// Build the true-wall paths independently, then assign both rough and finish
// topology back to the source parts. Offset output indices are not provenance:
// a thin part can vanish from only one of the two offsets.
function finishingProfileToolpaths(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  toolDiameterMm: number,
  handedness: FrameHandedness,
): ReadonlyArray<Polyline> {
  const side = settings.cutType === 'profile-inside' ? 'inside' : 'outside';
  const raw = orderInnerFirst(profileToolpathPolylines(polylines, side, toolDiameterMm));
  return settings.cutDirection === undefined
    ? raw
    : enforceCutDirection(raw, settings.cutDirection, settings.cutType, handedness);
}

type FinishingPassesContext = {
  readonly finishingSettings?: CncLayerSettings;
  readonly settings: CncLayerSettings;
  readonly toolDiameterMm: number;
  readonly roughingToolpaths: ReadonlyArray<Polyline>;
  readonly manualTabCenters: ReadonlyMap<Polyline, ReadonlyArray<number>>;
};

function finishingPasses(
  toolpaths: ReadonlyArray<Polyline>,
  zMm: number,
  ctx: FinishingPassesContext,
): ReadonlyArray<CncPass> {
  const depthsFor = finishingDepths(toolpaths, zMm, ctx);
  return toolpaths.flatMap((toolpath) =>
    depthsFor(toolpath).flatMap((depth) => {
      const pass = finishingPass(toolpath, depth, {
        settings: ctx.settings,
        toolDiameterMm: ctx.toolDiameterMm,
        manualCenters: ctx.manualTabCenters.get(toolpath),
      });
      return pass === null
        ? []
        : [ctx.finishingSettings === undefined ? pass : profileFinishStagePass(pass)];
    }),
  );
}

// A Wall finishing recipe sets the finishing depth per pass. Without one the
// finishing contour is a single full-depth pass beside a roughed wall, and
// follows the layer's depth ladder where roughing never reached it
// (ADR-140 Amendment 1) or where the allowance is the cutter radius, half the
// cutter in stock (Amendment 2).
function finishingDepths(
  toolpaths: ReadonlyArray<Polyline>,
  zMm: number,
  ctx: FinishingPassesContext,
): (toolpath: Polyline) => ReadonlyArray<number> {
  if (ctx.finishingSettings !== undefined) {
    const depths = zPassDepths(-zMm, ctx.finishingSettings.depthPerPassMm);
    return () => depths;
  }
  if (toolpaths.length === 0) return () => [zMm];
  const ladder = zPassDepths(-zMm, ctx.settings.depthPerPassMm);
  if (finishAllowanceReachesRadius(ctx.settings, ctx.toolDiameterMm)) return () => ladder;
  const reach = roughingReach(
    ctx.roughingToolpaths,
    ctx.toolDiameterMm / 2 + profileFinishAllowanceMm(ctx.settings, ctx.toolDiameterMm),
  );
  return (toolpath) => (reach.covers(toolpath) ? [zMm] : ladder);
}

function appendUnassignedParts(
  passes: CncPass[],
  roughParts: ReadonlyArray<ReadonlyArray<Polyline>>,
  finishParts: ReadonlyArray<ReadonlyArray<Polyline>>,
  settings: CncLayerSettings,
  toolDiameterMm: number,
  manualTabCenters: ReadonlyMap<Polyline, ReadonlyArray<number>>,
  roughTabCenters: ReadonlyMap<Polyline, ReadonlyArray<number>>,
  roughingPassesForPart: RoughingPassesForPart,
  finishingSettings?: CncLayerSettings,
): void {
  const partCount = Math.max(roughParts.length, finishParts.length);
  for (let index = 0; index < partCount; index += 1) {
    const rough = roughParts[index] ?? [];
    const finish = finishParts[index] ?? [];
    passes.push(
      ...roughingPassesForPart(rough, roughTabCenters),
      ...finishingPasses(finish, -settings.depthMm, {
        settings,
        toolDiameterMm,
        roughingToolpaths: rough,
        manualTabCenters,
        ...(finishingSettings === undefined ? {} : { finishingSettings }),
      }),
    );
  }
}

type FinishingPassContext = {
  readonly settings: CncLayerSettings;
  readonly toolDiameterMm: number;
  readonly manualCenters: ReadonlyArray<number> | undefined;
};

// ADR-258: a tabbed finishing pass is ONE path3d that rises to the tab top, like
// the roughing passes. Its bridges are the layer's own (persisted anchors, else
// even spacing), where the layer puts them without an allowance; the roughing
// rings rise beside them (ADR-140 Amendment 2). Anything untabbed stays an
// ordinary contour.
function finishingPass(toolpath: Polyline, zMm: number, ctx: FinishingPassContext): CncPass | null {
  const { settings, toolDiameterMm, manualCenters } = ctx;
  const needsTabs =
    settings.tabsEnabled &&
    toolpath.closed &&
    passNeedsTabs(zMm, settings.depthMm, settings.tabHeightMm);
  if (needsTabs) {
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
    if (points !== null && points.length >= 2) {
      return { kind: 'path3d', points, closed: false };
    }
  }
  return toolpath.points.length >= 2 ? passFromPolyline(toolpath, zMm) : null;
}

function passFromPolyline(polyline: Polyline, zMm: number): CncPass {
  return { kind: 'contour', zMm, polyline: ensureRingClosure(polyline), closed: polyline.closed };
}

function ensureRingClosure(polyline: Polyline): ReadonlyArray<Vec2> {
  const { points, closed } = polyline;
  const first = points[0];
  const last = points[points.length - 1];
  if (!closed || first === undefined || last === undefined) return points;
  const alreadyClosed =
    Math.abs(first.x - last.x) <= COORD_EPS && Math.abs(first.y - last.y) <= COORD_EPS;
  return alreadyClosed ? points : [...points, first];
}
