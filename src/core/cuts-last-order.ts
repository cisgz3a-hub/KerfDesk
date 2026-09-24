// Sort Cuts Last: one reorder that runs each cut after the work it surrounds
// while every other relative order stays as the operator set it. LightBurn's
// version pushes every Line layer to the end, scores included, ordered by
// strength; here a Line operation moves only when it cuts around other work
// (cut-enclosure), so scoring and line engraving keep their place.
// https://docs.lightburnsoftware.com/2.1/Reference/CutsLayersWindow/
//
// Output runs artwork by run order and, within one artwork, operations by list
// order (ADR-211), so the sort writes both orders:
//   - operations: every non-cut operation first, then the cuts, innermost
//     first. An SVG with a red cut outline and black engraving is one
//     artwork, so only this order puts its engraving before its outline.
//   - artwork runs: runs without a cut first, then runs holding cuts,
//     innermost first, a run with its own engraving before a pure cut.

import { artworkRunUnits, type ArtworkRunUnit } from './artwork-run-units';
import { analyzeCutEnclosure, type CutEnclosure } from './cut-enclosure';
import type { Layer, ProjectOptimizationSettings, Scene } from './scene';

export type CutsLastOrder = {
  /** Operations recognised as cuts: closed Line work around other output. */
  readonly cutOperationCount: number;
  /** The sorted orders, or null when every cut already runs last. */
  readonly sorted: {
    readonly layers: ReadonlyArray<Layer>;
    readonly artworkOrder: ReadonlyArray<string>;
  } | null;
};

type LayerPriority = ProjectOptimizationSettings['layerPriority'];

type RankedUnit = {
  readonly unit: ArtworkRunUnit;
  readonly index: number;
  readonly holdsCut: boolean;
  readonly holdsOtherWork: boolean;
  readonly depth: number;
};

export function cutsLastOrder(scene: Scene, layerPriority: LayerPriority): CutsLastOrder {
  const enclosure = analyzeCutEnclosure(scene);
  const cutOperationCount = enclosure.cutOperationIds.size;
  if (cutOperationCount === 0) return { cutOperationCount, sorted: null };
  const layers = sortedOperations(scene.layers, enclosure, layerPriority);
  const units = artworkRunUnits(scene);
  const sortedUnits = sortedRunUnits(units, scene.layers, enclosure);
  const unitsMoved = sortedUnits.some((unit, index) => unit.key !== units[index]?.key);
  const layersMoved = layers.some((layer, index) => layer !== scene.layers[index]);
  if (!unitsMoved && !layersMoved) return { cutOperationCount, sorted: null };
  const artworkOrder = unitsMoved
    ? sortedUnits.flatMap((unit) => unit.objectIds)
    : (scene.artworkOrder ?? units.flatMap((unit) => unit.objectIds));
  return { cutOperationCount, sorted: { layers, artworkOrder } };
}

// Reverse layer priority runs each artwork's operations bottom-up, so the list
// is written with the cuts on top to keep them last in the output.
function sortedOperations(
  layers: ReadonlyArray<Layer>,
  enclosure: CutEnclosure,
  layerPriority: LayerPriority,
): ReadonlyArray<Layer> {
  const depth = (layer: Layer): number => enclosure.operationDepths.get(layer.id) ?? 0;
  const others = layers.filter((layer) => !enclosure.cutOperationIds.has(layer.id));
  const cuts = layers.filter((layer) => enclosure.cutOperationIds.has(layer.id));
  if (layerPriority === 'reverse-project-order') {
    return [...cuts.sort((left, right) => depth(left) - depth(right)), ...others];
  }
  return [...others, ...cuts.sort((left, right) => depth(right) - depth(left))];
}

function sortedRunUnits(
  units: ReadonlyArray<ArtworkRunUnit>,
  layers: ReadonlyArray<Layer>,
  enclosure: CutEnclosure,
): ReadonlyArray<ArtworkRunUnit> {
  const outputIds = new Set(layers.filter((layer) => layer.output).map((layer) => layer.id));
  const ranked = units.map(
    (unit, index): RankedUnit => ({
      unit,
      index,
      holdsCut: unit.operationIds.some((id) => enclosure.cutOperationIds.has(id)),
      holdsOtherWork: unit.operationIds.some(
        (id) => outputIds.has(id) && !enclosure.cutOperationIds.has(id),
      ),
      depth: Math.max(0, ...unit.objectIds.map((id) => enclosure.objectDepths.get(id) ?? 0)),
    }),
  );
  return ranked.sort(compareRunUnits).map((entry) => entry.unit);
}

function compareRunUnits(left: RankedUnit, right: RankedUnit): number {
  if (left.holdsCut !== right.holdsCut) return left.holdsCut ? 1 : -1;
  if (left.holdsCut) {
    if (left.depth !== right.depth) return right.depth - left.depth;
    if (left.holdsOtherWork !== right.holdsOtherWork) return left.holdsOtherWork ? -1 : 1;
  }
  return left.index - right.index;
}
