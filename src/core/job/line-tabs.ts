// Line-mode tabs at compile time (ADR-494, LBG-C05). They run where automatic
// tabs always ran: after kerf, before perforation. Every closed contour the
// automatic rule picks gets tabsPerShape tabs, or one per tabSpacingMm of its
// perimeter (at most tabMaxPerShape), spread evenly; a contour with tabs placed
// by hand (SceneObject.laserTabAnchors) takes exactly those instead, eligible
// or not. With neither spacing nor placed tabs this is applyAutomaticTabsToPolylines
// to the byte, so existing tabbed jobs compile unchanged.
//
// Tab power: a CutGroup has one power, so the tab spans burn as a second Line
// group of the same operation and artwork at the tab share of its power, right
// after the cut group (lineTabSpanGroups). Every output, the preview, both time
// estimates and Frame bounds already handle a further Line group of a layer.

import {
  automaticTabEligibility,
  evenTabCenters,
  splitClosedPolylineAtTabCenters,
  type TabCenters,
} from '../geometry/tab-layout';
import type { LayerOperationSettings, Polyline, Vec2 } from '../scene';
import type { CutGroup, CutSegment } from './job';
import {
  automaticTabLayoutFor,
  tabCountForPerimeter,
  tabCutPowerPercentFor,
  type AutomaticTabLayout,
} from './operation-cut-extras';

export type LineTabbing = {
  readonly segments: ReadonlyArray<CutSegment>;
  /** The tab spans, burned only when the operation has a tab power. */
  readonly tabSpans: ReadonlyArray<CutSegment>;
};

/** `placedTabPoints` maps a segment index to the machine-space centres of the
 * tabs placed by hand on it. */
export function applyLineTabs(
  segments: ReadonlyArray<CutSegment>,
  placedTabPoints: ReadonlyMap<number, ReadonlyArray<Vec2>>,
  settings: LayerOperationSettings,
): LineTabbing {
  if (!settings.tabsEnabled) return { segments, tabSpans: [] };
  // As before, turning tabs on rebuilds every segment from its points.
  const polylines: ReadonlyArray<Polyline> = segments.map((segment) => ({
    points: segment.polyline,
    closed: segment.closed,
  }));
  const sizeMm = Number.isFinite(settings.tabSizeMm) ? Math.max(0, settings.tabSizeMm) : 0;
  if (sizeMm <= 0)
    return {
      segments: polylines.map((polyline, index) => cutSegment(polyline, segments[index])),
      tabSpans: [],
    };
  const needsLegacyDepth =
    settings.tabSkipInnerShapes &&
    segments.some((segment) => segment.closed && segment.nesting?.topologyContour === undefined);
  const legacyEligible = needsLegacyDepth
    ? automaticTabEligibility(polylines, settings)
    : polylines.map((polyline) => polyline.closed);
  const eligible = segments.map((segment, index) =>
    settings.tabSkipInnerShapes && segment.nesting?.topologyContour !== undefined
      ? segment.closed && segment.nesting.depth % 2 === 0
      : legacyEligible[index] === true,
  );
  const layout = automaticTabLayoutFor(settings);
  const burns: CutSegment[] = [];
  const tabSpans: CutSegment[] = [];
  polylines.forEach((polyline, index) => {
    const centers = tabCentersFor(layout, placedTabPoints.get(index), eligible[index] === true);
    const split =
      centers === null || !polyline.closed
        ? null
        : splitClosedPolylineAtTabCenters(polyline, sizeMm, centers);
    if (split === null) {
      burns.push(cutSegment(polyline, segments[index]));
      return;
    }
    for (const burn of split.burns) burns.push(cutSegment(burn, segments[index]));
    for (const tab of split.tabs) tabSpans.push(cutSegment(tab, segments[index]));
  });
  return { segments: burns, tabSpans };
}

/** The group burning an operation's tab spans at its tab power, to follow the
 * operation's cut group; none while the tab power is 0 and the tabs stay uncut.
 * Same speed, passes, air and power mode; `power` already includes the share. */
export function lineTabSpanGroups(
  cut: Omit<CutGroup, 'kind' | 'segments'>,
  settings: LayerOperationSettings,
  tabSpans: ReadonlyArray<CutSegment>,
): ReadonlyArray<CutGroup> {
  const percent = tabCutPowerPercentFor(settings);
  if (percent <= 0 || tabSpans.length === 0) return [];
  const { finalPassOvercutMm: _noOvercut, ...fields } = cut;
  return [
    {
      ...fields,
      kind: 'cut',
      power: (cut.power * percent) / 100,
      tabSpanPowerPercent: percent,
      segments: tabSpans,
    },
  ];
}

function tabCentersFor(
  layout: AutomaticTabLayout,
  placed: ReadonlyArray<Vec2> | undefined,
  eligible: boolean,
): TabCenters | null {
  if (placed !== undefined && placed.length > 0) {
    return (_perimeter, along) => placed.map(along);
  }
  if (!eligible) return null;
  return (perimeter, along) =>
    evenTabCenters(tabCountForPerimeter(layout, perimeter))(perimeter, along);
}

function cutSegment(polyline: Polyline, source?: CutSegment): CutSegment {
  const segment = { polyline: polyline.points, closed: polyline.closed };
  return source?.nesting === undefined ? segment : { ...segment, nesting: source.nesting };
}
