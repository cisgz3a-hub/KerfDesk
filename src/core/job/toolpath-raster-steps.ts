// Raster-group toolpath steps — converts an image-mode RasterGroup into
// preview sweep steps (lead-in travel, burn cut, lead-out travel per span,
// bidirectional row order, wide-gap rapids). Split from toolpath.ts
// (Phase H.2 refactor); named -steps to leave the existing
// toolpath-raster.test.ts name for the behavior it covers.

import type { Vec2 } from '../scene';
import { planRasterRowSweeps, type RasterRowSweepPlan } from '../raster/raster-sweep-plan';
import type { RasterGroup } from './job';
import { rasterRowsInProviderOrder } from './raster-rows';
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
    for (const { rowIndex, row } of rasterRowsInProviderOrder(group)) {
      const reverse = (group.bidirectional ?? true) && emittedRowCount % 2 === 1;
      const sweepPlans = planRasterRowSweeps({
        row,
        pixelWidthMm,
        overscanMm: group.overscanMm,
        reverse,
        dotWidthCorrectionMm: group.dotWidthCorrectionMm,
        minXWorldMm: group.bounds.minX,
      });
      if (sweepPlans.length === 0) continue;
      const worldY = group.bounds.minY + (rowIndex + 0.5) * pixelHeightMm;
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
            rowIndex,
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
  const leadEnd = {
    x:
      (reverse ? activeStartX - sweepPlan.leadOutMm : activeEndX + sweepPlan.leadOutMm) + rowShiftX,
    y: worldY,
  };
  appendTravelStep(steps, prevEnd, leadStart);
  appendTravelStep(steps, leadStart, burnStart);
  // Walk the plan's runs rather than drawing one polyline across the whole
  // span. The emitter emits S0 for a zero-power run and the duration model
  // classifies it as feed-travel, so a span-wide cut painted burn across
  // internal white pixels and across the dot-width-corrected ends. Same order
  // and same targets as rasterSweepDurationRuns so all three agree.
  let head = burnStart;
  for (const run of sweepPlan.runs) {
    const target = { x: run.endXWorldMm + rowShiftX, y: worldY };
    if (target.x === head.x) continue;
    if (run.s > 0) {
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
          ...runPixelRange(head.x - rowShiftX, target.x - rowShiftX, group, pixelWidthMm),
        },
        polyline: [head, target],
        length: dist(head, target),
      });
    } else {
      appendTravelStep(steps, head, target);
    }
    head = target;
  }
  appendTravelStep(steps, head, leadEnd);
  return leadEnd;
}

// Source pixel range covered by one burn run. Derived from the run's own world
// extent (before the scan-offset shift, which moves the drawn line but not the
// sampled pixels) so a split span reports the pixels it actually burns instead
// of repeating the whole span's range on every piece.
function runPixelRange(
  aX: number,
  bX: number,
  group: RasterGroup,
  pixelWidthMm: number,
): { readonly pixelStartX: number; readonly pixelEndX: number } {
  const loX = Math.min(aX, bX);
  const hiX = Math.max(aX, bX);
  const lastPixel = group.pixelWidth - 1;
  const first = Math.floor((loX - group.bounds.minX) / pixelWidthMm);
  const last = Math.ceil((hiX - group.bounds.minX) / pixelWidthMm) - 1;
  return {
    pixelStartX: Math.min(Math.max(0, first), lastPixel),
    pixelEndX: Math.min(Math.max(0, last), lastPixel),
  };
}
