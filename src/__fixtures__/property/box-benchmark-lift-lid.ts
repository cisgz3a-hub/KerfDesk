// box-benchmark-lift-lid — the lift-off lid category of the box benchmark
// scorecard (ADR-693), split out at the file-size cap. Exact nominal
// geometry from the builder, the lip play contract on generated panels,
// divider composition and determinism, across inner and outer dimensions.

import { checkBoxAssembly } from '../../core/box/assembly-referee';
import { deriveBoxDims, type BoxSpec } from '../../core/box/box-spec';
import { generateBox } from '../../core/box/generate-box';
import { buildLiftLidParts, liftLidBodySpec } from '../../core/box/lift-lid-panels';
import { checkLiftLidAssembly } from '../../core/box/lift-lid-referee';
import type { PanelId } from '../../core/box/panel-claims';
import { maxOf, minOf } from '../../core/util';
import { spec } from './box-benchmark-support';

type Score = { readonly category: string; passed: number; total: number };

const SIZES: ReadonlyArray<readonly [number, number, number, number]> = [
  [80, 50, 30, 3],
  [120, 90, 40, 6],
  [60, 60, 20, 2],
];

const WALLS: ReadonlySet<string> = new Set(['bottom', 'front', 'back', 'left', 'right']);

export function scoreLiftLid(): Score {
  let passed = 0;
  let total = 0;
  for (const [w, d, h, t] of SIZES) {
    for (const dimensionMode of ['inner', 'outer'] as const) {
      const lidSpec: BoxSpec = {
        ...spec(w, d, h, t, 3 * t, 'lift-lid'),
        dimensionMode,
        clearanceMm: 0.2,
      };
      total += 3;
      if (nominalHolds(lidSpec)) passed += 1;
      if (fittedHolds(lidSpec)) passed += 1;
      if (JSON.stringify(generateBox(lidSpec)) === JSON.stringify(generateBox(lidSpec))) {
        passed += 1;
      }
    }
  }
  // Divider composition: walls slotted, dividers under the lip.
  total += 1;
  const combo: BoxSpec = {
    ...spec(120, 90, 40, 3, 9, 'lift-lid'),
    clearanceMm: 0.2,
    dividersXCount: 1,
    dividersYCount: 1,
  };
  const comboResult = generateBox(combo);
  if (comboResult.kind === 'generated' && comboResult.panels.length === 9) passed += 1;
  return { category: 'lift-lid', passed, total };
}

// The builder's rings before the fit pass: the body joints exact, the lid
// exactly the footprint, the lip drawn play/2 inside the opening.
function nominalHolds(lidSpec: BoxSpec): boolean {
  const parts = buildLiftLidParts(lidSpec).map((part) => ({
    panel: part.panel,
    outline: part.rings.outline,
  }));
  const walls = parts.flatMap((part) =>
    WALLS.has(part.panel) ? [{ panel: part.panel as PanelId, outline: part.outline }] : [],
  );
  if (checkBoxAssembly(walls, liftLidBodySpec(lidSpec)).length > 0) return false;
  // Everything but the lip is exact before the fit pass; the lip is drawn
  // with its half of the play already taken off.
  const others = checkLiftLidAssembly(parts, lidSpec, { playMm: 0 });
  if (!others.every((issue) => issue.startsWith('lid lip:'))) return false;
  const lip = parts.find((part) => part.panel === 'lid-lip');
  if (lip === undefined) return false;
  const dims = deriveBoxDims(lidSpec);
  const half = lidSpec.clearanceMm / 2;
  const xs = lip.outline.points.map((point) => point.x);
  const ys = lip.outline.points.map((point) => point.y);
  return (
    Math.abs(maxOf(xs) - minOf(xs) - (dims.innerWidthMm - half)) < 1e-9 &&
    Math.abs(maxOf(ys) - minOf(ys) - (dims.innerDepthMm - half)) < 1e-9
  );
}

function fittedHolds(lidSpec: BoxSpec): boolean {
  const result = generateBox(lidSpec);
  if (result.kind !== 'generated') return false;
  const locals = result.panels.map((panel) => ({
    panel: panel.panel,
    outline: {
      closed: panel.outline.closed,
      points: panel.outline.points.map((point) => ({
        x: point.x - panel.offsetMm.x,
        y: point.y - panel.offsetMm.y,
      })),
    },
  }));
  return checkLiftLidAssembly(locals, lidSpec, { playMm: lidSpec.clearanceMm }).length === 0;
}
