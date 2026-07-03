// Perceptual fixture for the box generator (ADR-106 verification §3).
// The predicted mask rasterizes the generated sheet outlines; the truth mask
// is built INDEPENDENTLY from the claim rectangles (face rect minus unowned
// cell bites minus unclaimed corner squares) — it never touches the outline
// walk or clipper. High IoU proves the drawn sheet IS the claimed material.
// PERCEPTUAL_ARTIFACTS=1 additionally writes side-by-side PNGs for eyeballs.

import { describe, expect, it } from 'vitest';
import type { BoxSpec } from '../../core/box';
import { generateBox } from '../../core/box';
import { buildPanelClaims } from '../../core/box/panel-claims';
import { compareMasks } from './compare';
import { createMask, rasterizePolylines, type Mask } from './rasterize';
import { writePerceptualArtifact } from './png';

const PX_PER_MM = 2;

const LASER: BoxSpec = {
  widthMm: 60,
  depthMm: 40,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'closed',
  clearanceMm: 0,
  relief: { kind: 'none' },
  partSpacingMm: 8,
};

const CNC: BoxSpec = {
  ...LASER,
  clearanceMm: 0.15,
  relief: { kind: 'corner-overcut', toolDiameterMm: 3.175 },
};

describe('box generator — perceptual sheet fidelity', () => {
  it('laser nominal sheet matches the analytic claim mask almost exactly', () => {
    const { predicted, truth } = masksFor(LASER);
    const metrics = compareMasks(predicted, truth);
    const artifact = writePerceptualArtifact('box-sheet-laser', predicted, truth);
    console.log(
      `[box-sheet] laser IoU=${metrics.iou.toFixed(4)} precision=${metrics.precision.toFixed(4)} recall=${metrics.recall.toFixed(4)}${artifact === null ? '' : ` artifact=${artifact}`}`,
    );
    expect(metrics.iou).toBeGreaterThanOrEqual(0.99);
  });

  it('CNC sheet stays within clearance+relief distance of the nominal mask', () => {
    const { predicted, truth } = masksFor(CNC);
    const metrics = compareMasks(predicted, truth);
    const artifact = writePerceptualArtifact('box-sheet-cnc', predicted, truth);
    console.log(
      `[box-sheet] cnc IoU=${metrics.iou.toFixed(4)} precision=${metrics.precision.toFixed(4)} recall=${metrics.recall.toFixed(4)}${artifact === null ? '' : ` artifact=${artifact}`}`,
    );
    // Clearance shrinks sub-pixel; reliefs bite ~1.2% of the material.
    expect(metrics.iou).toBeGreaterThanOrEqual(0.96);
    expect(metrics.recall).toBeGreaterThanOrEqual(0.96);
    // Fit only ever REMOVES material vs nominal: no spurious ink beyond the
    // rasterization edge band.
    expect(metrics.precision).toBeGreaterThanOrEqual(0.99);
  });
});

function masksFor(spec: BoxSpec): { predicted: Mask; truth: Mask } {
  const result = generateBox(spec);
  if (result.kind !== 'generated') throw new Error(`expected generated, got ${result.kind}`);
  const scaled = result.panels.map((panel) => ({
    closed: panel.outline.closed,
    points: panel.outline.points.map((p) => ({ x: p.x * PX_PER_MM, y: p.y * PX_PER_MM })),
  }));
  const width = Math.ceil(Math.max(...scaled.flatMap((pl) => pl.points.map((p) => p.x)))) + 2;
  const height = Math.ceil(Math.max(...scaled.flatMap((pl) => pl.points.map((p) => p.y)))) + 2;
  const predicted = rasterizePolylines(scaled, width, height);
  const truth = claimTruthMask(spec, result.panels, width, height);
  return { predicted, truth };
}

// Independent analytic mask: per panel, fill the face rect then carve every
// unowned interior cell (T deep along its side) and unclaimed corner square.
function claimTruthMask(
  spec: BoxSpec,
  panels: ReadonlyArray<{ readonly offsetMm: { x: number; y: number } }>,
  width: number,
  height: number,
): Mask {
  const mask = createMask(width, height);
  const t = spec.thicknessMm;
  buildPanelClaims(spec).forEach((claims, index) => {
    const offset = panels[index]?.offsetMm ?? { x: 0, y: 0 };
    fillRectMm(mask, offset.x, offset.y, offset.x + claims.sizeUMm, offset.y + claims.sizeVMm, 1);
    const sides = [
      { id: 'vMin', rect: (a: number, b: number) => [a, 0, b, t] as const },
      {
        id: 'vMax',
        rect: (a: number, b: number) => [a, claims.sizeVMm - t, b, claims.sizeVMm] as const,
      },
      { id: 'uMin', rect: (a: number, b: number) => [0, a, t, b] as const },
      {
        id: 'uMax',
        rect: (a: number, b: number) => [claims.sizeUMm - t, a, claims.sizeUMm, b] as const,
      },
    ] as const;
    for (const side of sides) {
      for (const interval of claims.sides[side.id]) {
        if (interval.owned) continue;
        const [x0, y0, x1, y1] = side.rect(interval.fromMm, interval.toMm);
        fillRectMm(mask, offset.x + x0, offset.y + y0, offset.x + x1, offset.y + y1, 0);
      }
    }
  });
  return mask;
}

// Same pixel-centre convention as rasterize.ts: pixel (x, y) belongs to the
// rect iff its centre lies inside the half-open mm box.
function fillRectMm(
  mask: Mask,
  x0Mm: number,
  y0Mm: number,
  x1Mm: number,
  y1Mm: number,
  value: 0 | 1,
): void {
  const xStart = Math.max(0, Math.ceil(x0Mm * PX_PER_MM - 0.5));
  const xEnd = Math.min(mask.width - 1, Math.ceil(x1Mm * PX_PER_MM - 0.5) - 1);
  const yStart = Math.max(0, Math.ceil(y0Mm * PX_PER_MM - 0.5));
  const yEnd = Math.min(mask.height - 1, Math.ceil(y1Mm * PX_PER_MM - 0.5) - 1);
  for (let y = yStart; y <= yEnd; y += 1) {
    for (let x = xStart; x <= xEnd; x += 1) {
      mask.data[y * mask.width + x] = value;
    }
  }
}
