import type { CncPass } from '../job';
import type { CncLayerSettings, Polyline, Vec2 } from '../scene';
import { passNeedsTabs, tabTopZMm } from './cnc-tabs';
import { tabFractionsFromReference, tabRampedPoints } from './cnc-tab-ramp';
import { manualTabCentersForToolpaths, type CollectedCncContour } from './cnc-manual-tab-mapping';
import { enforceCutDirection } from './motion-polish';
import { orderInnerFirst } from './profile-ordering';
import { profileToolpathPolylines } from './profile-paths';

const COORD_EPS = 1e-9;

// Stock-to-leave applies only to side-offset profiles. Other cut types keep
// their existing toolpaths and do not receive a finishing contour.
export function profileFinishAllowanceMm(settings: CncLayerSettings): number {
  const applies = settings.cutType === 'profile-outside' || settings.cutType === 'profile-inside';
  const allowance = settings.finishAllowanceMm ?? 0;
  return applies && Number.isFinite(allowance) && allowance > 0 ? allowance : 0;
}

// The finishing pass runs at full depth on the true contour. Its tab centers
// are projected from the matching roughing path so offset start vertices and
// perimeter changes cannot move the physical bridges.
export function finishingProfilePasses(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  toolDiameterMm: number,
  roughingToolpaths: ReadonlyArray<Polyline>,
  tabSources: ReadonlyArray<CollectedCncContour> = [],
): ReadonlyArray<CncPass> {
  const side = settings.cutType === 'profile-inside' ? 'inside' : 'outside';
  const raw = orderInnerFirst(profileToolpathPolylines(polylines, side, toolDiameterMm));
  const toolpaths =
    settings.cutDirection === undefined
      ? raw
      : enforceCutDirection(raw, settings.cutDirection, settings.cutType);
  const zMm = -settings.depthMm;
  const manualTabCenters = manualTabCentersForToolpaths(toolpaths, tabSources);
  const passes: CncPass[] = [];
  for (const toolpath of toolpaths) {
    const pass = finishingPass(toolpath, zMm, {
      settings,
      toolDiameterMm,
      roughingToolpaths,
      manualCenters: manualTabCenters.get(toolpath),
    });
    if (pass !== null) passes.push(pass);
  }
  return passes;
}

type FinishingPassContext = {
  readonly settings: CncLayerSettings;
  readonly toolDiameterMm: number;
  readonly roughingToolpaths: ReadonlyArray<Polyline>;
  readonly manualCenters: ReadonlyArray<number> | undefined;
};

// ADR-258: a tabbed finishing pass is ONE path3d that rises to the tab top, like
// the roughing passes. Persisted anchors win; otherwise the centres are projected
// from the matching roughing toolpath so an offset start vertex or perimeter change
// cannot move the physical bridges. Anything untabbed stays an ordinary contour.
function finishingPass(toolpath: Polyline, zMm: number, ctx: FinishingPassContext): CncPass | null {
  const { settings, toolDiameterMm, roughingToolpaths, manualCenters } = ctx;
  const needsTabs =
    settings.tabsEnabled &&
    toolpath.closed &&
    passNeedsTabs(zMm, settings.depthMm, settings.tabHeightMm);
  if (needsTabs) {
    const centres =
      manualCenters ??
      tabFractionsFromReference(toolpath, roughingToolpaths, settings.tabsPerShape) ??
      undefined;
    const points = tabRampedPoints(
      toolpath,
      zMm,
      tabTopZMm(settings.depthMm, settings.tabHeightMm),
      {
        tabWidthMm: settings.tabWidthMm,
        tabsPerShape: settings.tabsPerShape,
        toolDiameterMm,
      },
      centres,
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
