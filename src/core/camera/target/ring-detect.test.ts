// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bedPoint, projectWorldPoint, type LensModel } from '../model/camera-model';
import { lookAt, wideLens } from '../model/model-fixtures';
import { bedTargetLayout, type BedTargetArea } from './bed-target';
import { detectRingMarks } from './ring-detect';
import { matchBedTarget } from './target-match';
import { renderTargetScene } from './target-render-fixtures';

const lens = wideLens(1280);
const THICKNESS = 3;

/**
 * The overhead fixture's camera (360 mm above a 400 mm bed) scaled to the
 * bed, looking at the bed's middle from behind at `tiltDeg` from straight down.
 */
function tiltedCamera(bedWidth: number, bedHeight: number, tiltDeg: number) {
  const height = (360 * Math.max(bedWidth, bedHeight)) / 400;
  const middle = 0.525 * bedHeight;
  const back = height * Math.tan((tiltDeg * Math.PI) / 180);
  return lookAt([bedWidth / 2, middle - back, -height], [bedWidth / 2, middle, 0]);
}

function marginArea(bedWidth: number, bedHeight: number, marginMm: number): BedTargetArea {
  return {
    x: marginMm,
    y: marginMm,
    width: bedWidth - 2 * marginMm,
    height: bedHeight - 2 * marginMm,
  };
}

describe('detectRingMarks anchors across camera tilt, margin and bed', () => {
  // Before, an anchor counted only rings within 1.6 times its nearest ring as
  // neighbours, in picture pixels: a tilted camera shortens the steps along
  // one axis, and the x-arm anchor, whose neighbour on one side is the origin
  // anchor rather than a ring, lost that side. From 34° it failed at some
  // margins, and at 41° on every bed.
  const beds = [
    [400, 400],
    [300, 300],
    [400, 300],
  ] as const;
  it.each(beds)(
    'finds the three anchors and matches the target on a %i × %i mm bed',
    (bedWidth, bedHeight) => {
      for (const tiltDeg of [20, 34, 41]) {
        for (const marginMm of [5, 30]) {
          const pose = tiltedCamera(bedWidth, bedHeight, tiltDeg);
          const area = marginArea(bedWidth, bedHeight, marginMm);
          const layout = bedTargetLayout({ area });
          const frame = renderTargetScene({
            lens,
            pose,
            layout,
            sheet: area,
            sheetThicknessMm: THICKNESS,
            noise: 4,
            honeycombPitchMm: 6,
          });
          const marks = detectRingMarks(frame);
          const anchors = marks.filter((m) => m.anchor);
          const setup = `${tiltDeg}°, ${marginMm} mm margin`;
          expect(anchors.length, setup).toBe(3);
          for (const mark of layout.marks.filter((m) => m.anchor)) {
            const pixel = projectWorldPoint(lens, pose, bedPoint(mark.x, mark.y, THICKNESS));
            const seen = anchors.some(
              (a) => Math.hypot(a.x - (pixel?.x ?? Infinity), a.y - (pixel?.y ?? Infinity)) < 2,
            );
            expect(seen, `${setup}: anchor ${mark.col},${mark.row}`).toBe(true);
          }
          expect(matchBedTarget(marks, layout).kind, setup).toBe('ok');
        }
      }
    },
    120_000,
  );
});

describe('detectRingMarks with marks wider than its threshold window', () => {
  // The close-up lens of a camera on the laser head (ADR-449), 60 mm above a
  // 40 mm target, in a dim, flat-lit photo: the solid discs are 37 px across,
  // wider than the 30 px default window, so their middles were no darker than
  // the local mean and all three anchors read as rings.
  const headLens: LensModel = {
    intrinsics: { fx: 900, fy: 900, cx: 639.5, cy: 359.5 },
    distortion: [0.02, -0.01, 0, 0],
    imageWidth: 1280,
    imageHeight: 720,
  };

  it('looks again with a window sized from the rings and finds the anchors', () => {
    const layout = bedTargetLayout({ area: { x: 180, y: 130, width: 40, height: 40 } });
    const pose = lookAt([200, 150, -60], [200, 150.001, 0]);
    const rendered = renderTargetScene({
      lens: headLens,
      pose,
      layout,
      sheet: { x: 150, y: 100, width: 100, height: 100 },
      sheetThicknessMm: THICKNESS,
      noise: 2,
    });
    // A quarter of the rendered contrast around mid-grey.
    const frame = {
      ...rendered,
      data: Float32Array.from(rendered.data, (v) => 128 + (v - 128) / 4),
    };
    const marks = detectRingMarks(frame);
    expect(marks.filter((m) => m.anchor)).toHaveLength(3);
    expect(marks.filter((m) => !m.anchor)).toHaveLength(layout.marks.length - 3);
    const match = matchBedTarget(marks, layout);
    expect(match.kind === 'ok' && match.correspondences.length).toBe(layout.marks.length);
  }, 30_000);
});
