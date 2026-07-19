// Raster-group toolpath steps — converts an image-mode RasterGroup into
// preview sweep steps (lead-in travel, burn cut, lead-out travel per span,
// bidirectional row order, wide-gap rapids). Split from toolpath.ts
// (Phase H.2 refactor); named -steps to leave the existing
// toolpath-raster.test.ts name for the behavior it covers.

import type { Vec2 } from '../scene';
import { planRasterRowSweeps, type RasterRowSweepPlan } from '../raster/raster-sweep-plan';
import type { RasterGroup } from './job';
import { rasterRow } from './raster-rows';
import { offsetForSpeed, type ScanOffsetPoint } from './scan-offset';
import { appendTravelStep, dist } from './toolpath-math';
import type { ToolpathStep } from './toolpath-types';

export function appendRasterGroupSteps(
  steps: ToolpathStep[],
  initialPrevEnd: Vec2 | null,
  group: RasterGroup,
  scanningOffsets: ReadonlyArray<ScanOffsetPoint>,
): Vec2 | null {
  if (!hasUsableRasterGeometry(group)) return initialPrevEnd;
  const pixelWidthMm = (group.bounds.maxX - group.bounds.minX) / group.pixelWidth;
  const pixelHeightMm = (group.bounds.maxY - group.bounds.minY) / group.pixelHeight;
  const scanOffsetMm =
    group.bidirectionalScanOffsetMm ?? offsetForSpeed(scanningOffsets, group.speed);
  const passes = Math.max(1, Math.floor(group.passes));
  let prevEnd = initialPrevEnd;
  for (let pass = 0; pass < passes; pass += 1) {
    let emittedRowCount = 0;
    for (let y = 0; y < group.pixelHeight; y += 1) {
      const reverse = (group.bidirectional ?? true) && emittedRowCount % 2 === 1;
      const sweepPlans = planRasterRowSweeps({
        row: rasterRow(group, y),
        pixelWidthMm,
        overscanMm: group.overscanMm,
        reverse,
      });
      if (sweepPlans.length === 0) continue;
      const worldY = group.bounds.minY + (y + 0.5) * pixelHeightMm;
      for (let spanIndex = 0; spanIndex < sweepPlans.length; spanIndex += 1) {
        const sweepPlan = sweepPlans[spanIndex];
        if (sweepPlan === undefined) continue;
        prevEnd = appendRasterSpanSweepSteps(
          steps,
          prevEnd,
          group,
          sweepPlan,
          worldY,
          reverse,
          scanOffsetMm,
          {
            passIndex: pass,
            rowIndex: y,
            spanIndex,
          },
        );
      }
      emittedRowCount += 1;
    }
  }
  return prevEnd;
}

function hasUsableRasterGeometry(group: RasterGroup): boolean {
  return (
    group.pixelWidth > 0 &&
    group.pixelHeight > 0 &&
    (group.rowProvider !== undefined ||
      group.sValues.length >= group.pixelWidth * group.pixelHeight) &&
    group.bounds.maxX > group.bounds.minX &&
    group.bounds.maxY > group.bounds.minY
  );
}

function appendRasterSpanSweepSteps(
  steps: ToolpathStep[],
  prevEnd: Vec2 | null,
  group: RasterGroup,
  sweepPlan: RasterRowSweepPlan,
  worldY: number,
  reverse: boolean,
  scanOffsetMm: number,
  sourcePosition: {
    readonly passIndex: number;
    readonly rowIndex: number;
    readonly spanIndex: number;
  },
): Vec2 {
  const span = sweepPlan.span;
  const pixelWidthMm = (group.bounds.maxX - group.bounds.minX) / group.pixelWidth;
  const activeStartX = group.bounds.minX + span.firstX * pixelWidthMm;
  const activeEndX = group.bounds.minX + (span.lastX + 1) * pixelWidthMm;
  const rowShiftX = reverse ? -scanOffsetMm : 0;
  const leadStart = {
    x: (reverse ? activeEndX + sweepPlan.leadInMm : activeStartX - sweepPlan.leadInMm) + rowShiftX,
    y: worldY,
  };
  const burnStart = {
    x: (reverse ? activeEndX : activeStartX) + rowShiftX,
    y: worldY,
  };
  const burnEnd = {
    x: (reverse ? activeStartX : activeEndX) + rowShiftX,
    y: worldY,
  };
  const leadEnd = {
    x:
      (reverse ? activeStartX - sweepPlan.leadOutMm : activeEndX + sweepPlan.leadOutMm) + rowShiftX,
    y: worldY,
  };
  appendTravelStep(steps, prevEnd, leadStart);
  appendTravelStep(steps, leadStart, burnStart);
  steps.push({
    kind: 'cut',
    color: group.color,
    source: {
      kind: 'raster',
      ...(group.sourceObjectId === undefined ? {} : { objectId: group.sourceObjectId }),
      ...(group.source === undefined ? {} : { source: group.source }),
      passIndex: sourcePosition.passIndex,
      rowIndex: sourcePosition.rowIndex,
      spanIndex: sourcePosition.spanIndex,
      pixelStartX: span.firstX,
      pixelEndX: span.lastX,
    },
    polyline: [burnStart, burnEnd],
    length: dist(burnStart, burnEnd),
  });
  appendTravelStep(steps, burnEnd, leadEnd);
  return leadEnd;
}
