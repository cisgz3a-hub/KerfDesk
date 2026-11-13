// The contour depth ladder of a profile layer, with its holding tabs
// (ADR-258 and its Amendment 5).
//
// Each loop is planned once (cnc-tab-placement.ts), so every level rises at the
// same tabs, and the plan says what the operator would not otherwise see:
//
//   * a loop too short for even one tab rides the tab top whole and is never
//     cut free. It is cut once at the tab top, not once per level below it
//     (J1-P3-1), and Job Review names it (J1-P1-1);
//   * a loop too short for the tabs set gets as many as still let it cut
//     through, and a tab whose window turns so far that its bridge is under
//     half the set width is named too (N1-P2-1);
//   * an open outline whose ends lie closer than the cut width is closed by the
//     bit, so its part comes free exactly like a closed one's. It is tabbed as
//     the loop it makes, but still cut from its first point to its last
//     (N1-P2-2), and an open outline wider apart keeps the ADR-258 Amendment 4
//     rule: no tab.
//
// Pure: no clock, no randomness, no I/O.

import type { CncPass } from '../job';
import type { CncTabHoldShape } from '../job/cnc-compilation-sidecar-types';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
import type { CncLayerSettings, Polyline, Vec2 } from '../scene';
import { contourPassFromPolyline, isProfileCutType } from './compile-cnc-helpers';
import { depthsWithTabTopPass, passNeedsTabs, tabTopZMm } from './cnc-tabs';
import {
  tabPlanForToolpath,
  tabRampedOpenPoints,
  tabRampedPoints,
  type TabRampSettings,
} from './cnc-tab-ramp';
import { modulo, pointAtDistance, tabLoop, type TabPlan } from './cnc-tab-placement';
import { maxOf, minOf } from '../util';

const EPS = 1e-9;

export type CncTabHoldFinding = Omit<CncTabHoldShape, 'layerId' | 'layerName'>;

export type TabbedContourPasses = {
  readonly passes: ReadonlyArray<CncPass>;
  readonly tabHolds: ReadonlyArray<CncTabHoldFinding>;
};

type TabbedLoop = {
  readonly toolpath: Polyline;
  /** The closed loop the tabs are planned on. */
  readonly loop: Polyline;
  /** An open outline the bit closes: cut from its first point to its last. */
  readonly open: boolean;
  readonly plan: TabPlan | null;
  readonly rampSettings: TabRampSettings;
};

export function contourMajorPasses(
  toolpaths: ReadonlyArray<Polyline>,
  depths: ReadonlyArray<number>,
  settings: CncLayerSettings,
  cutWidthMm: number,
  manualTabCenters: ReadonlyMap<Polyline, ReadonlyArray<number>> = new Map(),
  tabCounts: ReadonlyMap<Polyline, number> = new Map(),
): TabbedContourPasses {
  const wantsTabs = settings.tabsEnabled && isProfileCutType(settings.cutType);
  const tabbedDepths = wantsTabs ? depthsWithTabTopPass(depths, settings) : depths;
  const loops = toolpaths.map((toolpath) =>
    wantsTabs
      ? tabbedLoop(toolpath, settings, cutWidthMm, {
          manual: manualTabCenters.get(toolpath),
          count: tabCounts.get(toolpath) ?? settings.tabsPerShape,
        })
      : null,
  );
  const passes: CncPass[] = [];
  toolpaths.forEach((toolpath, index) => {
    const tabbed = loops[index] ?? null;
    if (tabbed === null) {
      for (const zMm of depths) passes.push(contourPassFromPolyline(toolpath, zMm));
      return;
    }
    for (const zMm of tabbedDepths) appendLevel(passes, tabbed, zMm, settings);
  });
  return { passes, tabHolds: wantsTabs ? tabHoldFindings(loops, settings, cutWidthMm) : [] };
}

function tabbedLoop(
  toolpath: Polyline,
  settings: CncLayerSettings,
  cutWidthMm: number,
  tabs: { readonly manual: ReadonlyArray<number> | undefined; readonly count: number },
): TabbedLoop | null {
  const open = !toolpath.closed;
  if (open && !bitClosesOutline(toolpath, cutWidthMm)) return null;
  const loop: Polyline = open ? { ...toolpath, closed: true } : toolpath;
  const rampSettings: TabRampSettings = {
    tabWidthMm: settings.tabWidthMm,
    tabsPerShape: tabs.count,
    toolDiameterMm: cutWidthMm,
  };
  const plan = tabPlanForToolpath(loop, rampSettings, open ? undefined : tabs.manual);
  if (open || plan === null) return { toolpath, loop, open, plan, rampSettings };
  const started = startingInTab(toolpath, plan);
  return { toolpath: started.loop, loop: started.loop, open, plan: started.plan, rampSettings };
}

// Every level of a tabbed loop starts in the middle of the tab nearest its
// seam, so the lead each level gets joins at one place, and on the levels
// below the tab top it rides the tab top there: a lead joined where the ring
// runs at the cutting depth sweeps through-depth material beside the two
// tabs either side, and on a small hole that narrows or erases them (N1-P2-3).
function startingInTab(
  toolpath: Polyline,
  plan: TabPlan,
): { readonly loop: Polyline; readonly plan: TabPlan } {
  const measured = tabLoop(toolpath.points);
  if (measured === null || plan.coversLoop || plan.centers.length === 0) {
    return { loop: toolpath, plan };
  }
  const perimeter = measured.perimeter;
  const offset = plan.centers.reduce((best, center) =>
    Math.min(center, perimeter - center) < Math.min(best, perimeter - best) ? center : best,
  );
  if (Math.min(offset, perimeter - offset) <= EPS) return { loop: toolpath, plan };
  let edge = 0;
  while (edge + 1 < measured.points.length && (measured.cumulative[edge + 1] as number) <= offset) {
    edge += 1;
  }
  const points = measured.points;
  const onVertex = offset - (measured.cumulative[edge] as number) <= EPS;
  const rotated = onVertex
    ? [...points.slice(edge), ...points.slice(0, edge)]
    : [pointAtDistance(measured, offset), ...points.slice(edge + 1), ...points.slice(0, edge + 1)];
  return {
    loop: { ...toolpath, points: rotated },
    plan: { ...plan, centers: plan.centers.map((center) => modulo(center - offset, perimeter)) },
  };
}

// An open outline whose ends lie closer than the cut width, around an area
// larger than the bit's own footprint: the bit sweeps its gap, so it frees what
// it outlines just as a closed loop does.
function bitClosesOutline(toolpath: Polyline, cutWidthMm: number): boolean {
  const first = toolpath.points[0];
  const last = toolpath.points[toolpath.points.length - 1];
  if (toolpath.points.length < 3 || first === undefined || last === undefined) return false;
  const gapMm = Math.hypot(last.x - first.x, last.y - first.y);
  return (
    gapMm < cutWidthMm - EPS && Math.abs(signedAreaMm2(toolpath.points)) > cutWidthMm * cutWidthMm
  );
}

function appendLevel(
  passes: CncPass[],
  tabbed: TabbedLoop,
  zMm: number,
  settings: CncLayerSettings,
): void {
  const { toolpath, plan } = tabbed;
  if (plan === null || !passNeedsTabs(zMm, settings.depthMm, settings.tabHeightMm)) {
    passes.push(contourPassFromPolyline(toolpath, zMm));
    return;
  }
  // A loop the windows cover rides the tab top on every level below it, so it
  // is cut once there, on the tab-top level, and not lapped again (J1-P3-1).
  if (plan.coversLoop) return;
  const tabTop = tabTopZMm(settings.depthMm, settings.tabHeightMm);
  const points = tabbed.open
    ? tabRampedOpenPoints(tabbed.loop, zMm, tabTop, plan)
    : tabRampedPoints(tabbed.loop, zMm, tabTop, tabbed.rampSettings, undefined, plan);
  if (points === null || points.length < 2) {
    passes.push(contourPassFromPolyline(toolpath, zMm));
    return;
  }
  passes.push({ kind: 'path3d', points, closed: false });
}

// What Job Review says about each loop whose tabs are not the ones set. Only a
// cut deeper than its tab has tabs at all.
function tabHoldFindings(
  loops: ReadonlyArray<TabbedLoop | null>,
  settings: CncLayerSettings,
  cutWidthMm: number,
): ReadonlyArray<CncTabHoldFinding> {
  if (!passNeedsTabs(-settings.depthMm, settings.depthMm, settings.tabHeightMm)) return [];
  const present = loops.filter((loop): loop is TabbedLoop => loop !== null && loop.plan !== null);
  const outerSign = dominantWindingSign(present.map((loop) => loop.loop));
  return present.flatMap((tabbed) => {
    const plan = tabbed.plan as TabPlan;
    const base = loopFacts(tabbed, settings, cutWidthMm, outerSign, plan);
    const findings: CncTabHoldFinding[] = [];
    if (tabbed.open) findings.push({ ...base, kind: 'closed-gap' });
    if (plan.coversLoop) return [...findings, { ...base, kind: 'never-through' }];
    if (plan.centers.length < plan.requested) findings.push({ ...base, kind: 'fewer-tabs' });
    const bridge = plan.narrowestBridgeMm;
    if (bridge !== null && bridge < settings.tabWidthMm / 2 - EPS) {
      findings.push({ ...base, kind: 'narrow-bridge', bridgeMm: Math.max(0, bridge) });
    }
    return findings;
  });
}

function loopFacts(
  tabbed: TabbedLoop,
  settings: CncLayerSettings,
  cutWidthMm: number,
  outerSign: number,
  plan: TabPlan,
): Omit<CncTabHoldFinding, 'kind'> {
  const sign = Math.sign(signedAreaMm2(tabbed.loop.points));
  const isOuter = outerSign === 0 || sign === outerSign;
  // A loop cut on its outside is one cut width larger than the drawn shape, one
  // cut on its inside one cut width smaller, and one cut on its line the same.
  const cutsOutside =
    settings.cutType === 'profile-outside'
      ? isOuter
      : settings.cutType === 'profile-inside'
        ? !isOuter
        : null;
  const grow = tabbed.open || cutsOutside === null ? 0 : cutsOutside ? -cutWidthMm : cutWidthMm;
  const size = boundsSize(tabbed.loop.points);
  return {
    role: (settings.cutType === 'profile-inside' ? !isOuter : isOuter) ? 'part' : 'hole',
    widthMm: Math.max(0, size.width + grow),
    heightMm: Math.max(0, size.height + grow),
    tabsSet: plan.requested,
    tabsCut: plan.coversLoop ? 0 : plan.centers.length,
    tabWidthMm: settings.tabWidthMm,
    cutWidthMm,
  };
}

function boundsSize(points: ReadonlyArray<Vec2>): { width: number; height: number } {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    width: maxOf(xs) - minOf(xs),
    height: maxOf(ys) - minOf(ys),
  };
}

// The largest loop carries the outer boundary's winding; one winding the other
// way is a hole (as motion-polish.ts and profile-lead-passes.ts read it).
function dominantWindingSign(loops: ReadonlyArray<Polyline>): number {
  let maxAbsArea = 0;
  let sign = 0;
  for (const loop of loops) {
    const area = signedAreaMm2(loop.points);
    if (Math.abs(area) > maxAbsArea) {
      maxAbsArea = Math.abs(area);
      sign = Math.sign(area);
    }
  }
  return sign;
}
