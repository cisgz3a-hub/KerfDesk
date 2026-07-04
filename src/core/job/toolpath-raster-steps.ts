// Raster-group toolpath steps — converts an image-mode RasterGroup into
// preview sweep steps (lead-in travel, burn cut, lead-out travel per span,
// bidirectional row order, wide-gap rapids). Split from toolpath.ts
// (Phase H.2 refactor); named -steps to leave the existing
// toolpath-raster.test.ts name for the behavior it covers.

import type { Vec2 } from '../scene';
import type { RasterGroup } from './job';
import { offsetForSpeed, type ScanOffsetPoint } from './scan-offset';
import { appendTravelStep, dist } from './toolpath-math';
import type { ToolpathStep } from './toolpath-types';

const RASTER_GAP_RAPID_THRESHOLD_MM = 5;

type RasterSpan = { readonly firstX: number; readonly lastX: number };

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
      const spans = rasterActiveSpans(group, y, pixelWidthMm);
      if (spans.length === 0) continue;
      const worldY = group.bounds.minY + (y + 0.5) * pixelHeightMm;
      const reverse = (group.bidirectional ?? true) && emittedRowCount % 2 === 1;
      const ordered = reverse ? [...spans].reverse() : spans;
      for (let spanIndex = 0; spanIndex < ordered.length; spanIndex += 1) {
        const span = ordered[spanIndex];
        if (span === undefined) continue;
        prevEnd = appendRasterSpanSweepSteps(
          steps,
          prevEnd,
          group,
          span,
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
    group.sValues.length >= group.pixelWidth * group.pixelHeight &&
    group.bounds.maxX > group.bounds.minX &&
    group.bounds.maxY > group.bounds.minY
  );
}

function rasterActiveSpans(
  group: RasterGroup,
  y: number,
  pixelWidthMm: number,
): ReadonlyArray<RasterSpan> {
  const rowStart = y * group.pixelWidth;
  const spans: RasterSpan[] = [];
  let firstX = -1;
  let lastInk = -1;
  for (let x = 0; x < group.pixelWidth; x += 1) {
    if ((group.sValues[rowStart + x] ?? 0) <= 0) continue;
    if (firstX === -1) {
      firstX = x;
      lastInk = x;
      continue;
    }
    const gapMm = (x - lastInk - 1) * pixelWidthMm;
    if (gapMm > RASTER_GAP_RAPID_THRESHOLD_MM) {
      spans.push({ firstX, lastX: lastInk });
      firstX = x;
    }
    lastInk = x;
  }
  if (firstX !== -1) spans.push({ firstX, lastX: lastInk });
  return spans;
}

function appendRasterSpanSweepSteps(
  steps: ToolpathStep[],
  prevEnd: Vec2 | null,
  group: RasterGroup,
  span: RasterSpan,
  worldY: number,
  reverse: boolean,
  scanOffsetMm: number,
  sourcePosition: {
    readonly passIndex: number;
    readonly rowIndex: number;
    readonly spanIndex: number;
  },
): Vec2 {
  const pixelWidthMm = (group.bounds.maxX - group.bounds.minX) / group.pixelWidth;
  const activeStartX = group.bounds.minX + span.firstX * pixelWidthMm;
  const activeEndX = group.bounds.minX + (span.lastX + 1) * pixelWidthMm;
  const overscanMm = Math.max(0, group.overscanMm);
  const rowShiftX = reverse ? -scanOffsetMm : 0;
  const leadStart = {
    x: (reverse ? activeEndX + overscanMm : activeStartX - overscanMm) + rowShiftX,
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
    x: (reverse ? activeStartX - overscanMm : activeEndX + overscanMm) + rowShiftX,
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
