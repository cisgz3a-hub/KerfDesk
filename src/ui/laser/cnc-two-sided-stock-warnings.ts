// Job Review advisories for the sides of a two-sided split (ADR-580 Amendment
// 1). Relief CAM re-plans each recorded side for the current stock, so what is
// left to say is where that plan is not the model: stock thinner than the model
// caps it, a side with no stock left drops out of its program, and a side split
// by an earlier version has no record to follow the stock with.

import { reliefSideForStock } from '../../core/relief/relief-two-sided-stock';
import type { Project, SceneObject } from '../../core/scene';
import type { MeshReliefObject } from '../../core/scene/relief';
import { formatUpTo2Decimals } from '../../core/util/number-format';

// The names the split gives its sides (relief-two-sided-actions.ts).
const SPLIT_SIDE_NAME = /\(side [AB], (top|bottom)\)$/;

export function detectCncTwoSidedStockWarnings(project: Project): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return [];
  const stockMm = machine.stock.thicknessMm;
  const sides = project.cncSetup?.twoSided;
  const active =
    sides === undefined
      ? null
      : new Set(sides.activeSide === 'A' ? sides.sideAObjectIds : sides.sideBObjectIds);
  const warnings = project.scene.objects.flatMap((object) => {
    const relief = splitSide(object);
    if (relief === null || (active !== null && !active.has(relief.id))) return [];
    const warning = sideWarning(relief, stockMm);
    return warning === null ? [] : [warning];
  });
  return [...new Set(warnings)];
}

function splitSide(object: SceneObject): MeshReliefObject | null {
  if (object.kind !== 'relief' || object.reliefSource.kind !== 'legacy-mesh') return null;
  const relief = object as MeshReliefObject;
  return relief.twoSidedSplit !== undefined || SPLIT_SIDE_NAME.test(relief.source) ? relief : null;
}

function sideWarning(relief: MeshReliefObject, stockMm: number): string | null {
  const record = relief.twoSidedSplit;
  const name = `"${relief.source}"`;
  if (record === undefined) {
    return (
      `${name} was split by an earlier version, which did not record the stock it was ` +
      'planned for, so it cannot follow a change to the stock thickness. If the thickness ' +
      'changed after the split, re-split the model for the new stock.'
    );
  }
  const model = `the ${formatUpTo2Decimals(record.modelDepthMm)} mm model`;
  const fit = reliefSideForStock(relief, stockMm);
  if (fit.kind === 'no-stock') {
    return (
      `${name} has no stock to carve: ${model} is thicker than the ${formatUpTo2Decimals(stockMm)} mm stock, ` +
      'which lies wholly on the other side of the split, so this side’s program leaves it out.'
    );
  }
  if (fit.kind === 'unrecognised') {
    return (
      `${name} no longer has the depth, floor and frame its split gave it, so it cannot follow ` +
      `the ${formatUpTo2Decimals(stockMm)} mm stock and is carved as stored, for the ` +
      `${formatUpTo2Decimals(record.stockThicknessMm)} mm stock it was split for. Re-split the model for the new ` +
      'stock.'
    );
  }
  if (fit.kind === 'refit' && fit.capped) {
    return (
      `${capitalised(model)} of ${name} is thicker than the ${formatUpTo2Decimals(stockMm)} mm stock: both stock ` +
      `faces cut it down, so the part comes out ${formatUpTo2Decimals(stockMm)} mm thick. The holding web is kept.`
    );
  }
  return null;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
