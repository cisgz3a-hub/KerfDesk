// LightBurn's "Sort cuts last", expressed through KerfDesk's saved orders
// (LBG-C07). It never crosses artwork priority (ADR-211): it rewrites the
// operation order used inside each artwork and the artwork run order itself,
// so the compiler keeps a single ordering rule.
import { artworkRunUnits, type ArtworkRunUnit } from './artwork-run-units';
import {
  effectiveObjectPowerPercent,
  effectiveOperationForObject,
} from './effective-output/effective-output';
import {
  isRegistrationLayer,
  outputOperationLayers,
  sceneObjectUsesOperation,
  type Layer,
  type LayerMode,
  type Scene,
  type SceneObject,
} from './scene';

export type SortCutsLastResult = {
  /** The input scene itself when nothing moves. */
  readonly scene: Scene;
  /** Line operations whose place in the operation order changed. */
  readonly movedCutOperations: number;
  /** Run-order units that now run later than before. */
  readonly artworkMovedLater: number;
  /** Units with output that both engrave and cut. */
  readonly engraveAndCutArtwork: number;
};

type ArtworkProcess = {
  readonly engraves: boolean;
  readonly cuts: boolean;
  readonly strongestCut: number;
};

type RankedUnit = {
  readonly unit: ArtworkRunUnit;
  readonly index: number;
  readonly process: ArtworkProcess;
};

const NO_PROCESS: ArtworkProcess = { engraves: false, cuts: false, strongestCut: 0 };

/** Relative Line strength: power × passes ÷ speed. */
export function lineOperationStrength(settings: Pick<Layer, 'power' | 'passes' | 'speed'>): number {
  const strength = (settings.power * settings.passes) / settings.speed;
  return Number.isFinite(strength) ? strength : Number.MAX_VALUE;
}

/**
 * Keeps Fill/Image operations in place first, then Line operations weakest to
 * strongest. The registration jig is burned in its own run before the artwork
 * (ADR-057), so it is not a cut to move and keeps its place with the first group.
 */
export function cutsLastOperationOrder(layers: ReadonlyArray<Layer>): ReadonlyArray<Layer> {
  const cuts = layers
    .filter(isSortableCut)
    .map((layer, index) => ({ layer, index, strength: lineOperationStrength(layer) }))
    .sort((left, right) => left.strength - right.strength || left.index - right.index)
    .map(({ layer }) => layer);
  return [...layers.filter((layer) => !isSortableCut(layer)), ...cuts];
}

function isSortableCut(layer: Layer): boolean {
  return layer.mode === 'line' && !isRegistrationLayer(layer);
}

/**
 * Engraving-only artwork first, then artwork that engraves and cuts, then
 * cut-only artwork weakest first. Run units stay whole, and units without an
 * output operation keep their exact run position.
 */
export function sortCutsLast(scene: Scene): SortCutsLastResult {
  const layers = cutsLastOperationOrder(scene.layers);
  const objectById = new Map(scene.objects.map((object) => [object.id, object]));
  const ranked = artworkRunUnits(scene).map((unit, index) => ({
    unit,
    index,
    process: unitProcess(scene.layers, unit, objectById),
  }));
  const sorted = ranked.filter(hasOutput).sort(compareRankedUnits);
  let cursor = 0;
  const units = ranked.map((entry) => (hasOutput(entry) ? (sorted[cursor++] ?? entry) : entry));
  const layersMoved = layers.some((layer, index) => layer !== scene.layers[index]);
  const unitsMoved = units.some((entry, index) => entry.index !== index);
  return {
    scene:
      layersMoved || unitsMoved
        ? {
            ...scene,
            ...(layersMoved ? { layers } : {}),
            ...(unitsMoved ? { artworkOrder: units.flatMap((entry) => entry.unit.objectIds) } : {}),
          }
        : scene,
    movedCutOperations: layers.filter(
      (layer, index) => isSortableCut(layer) && layer !== scene.layers[index],
    ).length,
    artworkMovedLater: units.filter((entry, index) => index > entry.index).length,
    engraveAndCutArtwork: ranked.filter((entry) => processRank(entry.process) === 1).length,
  };
}

function hasOutput(entry: RankedUnit): boolean {
  return processRank(entry.process) !== null;
}

function compareRankedUnits(left: RankedUnit, right: RankedUnit): number {
  const leftRank = processRank(left.process) ?? 0;
  const rankOrder = leftRank - (processRank(right.process) ?? 0);
  if (rankOrder !== 0) return rankOrder;
  const strengthOrder = leftRank === 2 ? left.process.strongestCut - right.process.strongestCut : 0;
  return strengthOrder || left.index - right.index;
}

function processRank(process: ArtworkProcess): 0 | 1 | 2 | null {
  if (process.engraves) return process.cuts ? 1 : 0;
  return process.cuts ? 2 : null;
}

function unitProcess(
  layers: ReadonlyArray<Layer>,
  unit: ArtworkRunUnit,
  objectById: ReadonlyMap<string, SceneObject>,
): ArtworkProcess {
  return unit.objectIds
    .flatMap((id) => {
      const object = objectById.get(id);
      return object === undefined ? [] : [objectProcess(layers, object)];
    })
    .reduce(
      (merged, process) => ({
        engraves: merged.engraves || process.engraves,
        cuts: merged.cuts || process.cuts,
        strongestCut: Math.max(merged.strongestCut, process.strongestCut),
      }),
      NO_PROCESS,
    );
}

// Effective operations: every output-enabled operation and sub-operation the
// artwork uses, with its per-artwork settings and power scale applied.
function objectProcess(layers: ReadonlyArray<Layer>, object: SceneObject): ArtworkProcess {
  let engraves = false;
  let cuts = false;
  let strongestCut = 0;
  for (const layer of layers) {
    if (isRegistrationLayer(layer) || !sceneObjectUsesOperation(object, layer)) continue;
    for (const operation of outputOperationLayers(layer)) {
      const effective = effectiveOperationForObject(operation, object);
      if (!producesLaserOutput(object, effective.mode)) continue;
      if (effective.mode !== 'line') {
        engraves = true;
        continue;
      }
      cuts = true;
      const power = effectiveObjectPowerPercent(effective, object);
      strongestCut = Math.max(strongestCut, lineOperationStrength({ ...effective, power }));
    }
  }
  return { engraves, cuts, strongestCut };
}

// Mirrors the laser compiler: bitmaps only engrave as Image, vectors never do,
// and relief artwork has no laser output.
function producesLaserOutput(object: SceneObject, mode: LayerMode): boolean {
  if (object.kind === 'relief') return false;
  if (object.kind === 'raster-image') return mode === 'image' && object.role !== 'trace-source';
  return mode !== 'image';
}
