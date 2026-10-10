// splitReliefForTwoSides — turn one STL relief into the side A (top) and side
// B (bottom) reliefs of a two-sided carve, in one undo step (ADR-579). The two
// reliefs replace the original where it stood, keep its operations, and are
// assigned to the project's two-sided setup (ADR-573), which is switched on
// with its ordinary defaults when it was off. Flip axis, side B origin and
// registration stay the operator's choices in Machine Setup.

import { applyTransform, type Layer, type SceneObject } from '../../core/scene';
import {
  defaultCncMachiningSetup,
  type CncMachiningSetup,
} from '../../core/scene/cnc-machining-setup';
import type { CncStock } from '../../core/scene/machine';
import type { MeshReliefObject } from '../../core/scene/relief';
import {
  splitReliefForTwoSides,
  type ReliefSideMesh,
  type ReliefTwoSidedOptions,
} from '../../core/relief/relief-two-sided-split';
import type { AppState } from './store';
import { pushUndo } from './scene-mutations';
import { removeObjectIdsFromGroups } from './scene-group-actions';

export type ReliefTwoSidedRequest = Omit<ReliefTwoSidedOptions, 'stockThicknessMm'>;

export type ReliefTwoSidedResult =
  | {
      readonly kind: 'ok';
      readonly sideAId: string;
      readonly sideBId: string;
      readonly stockThicknessMm: number;
      readonly fitsStock: boolean;
      readonly setupEnabled: boolean;
    }
  | { readonly kind: 'error'; readonly reason: string };

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function reliefTwoSidedActions(set: Setter): Pick<AppState, 'splitReliefForTwoSides'> {
  return {
    splitReliefForTwoSides: (id, request) => {
      let result: ReliefTwoSidedResult = { kind: 'error', reason: 'The relief was not found.' };
      set((state) => {
        const planned = plannedSplit(state, id, request);
        result = planned.result;
        return planned.next ?? state;
      });
      return result;
    },
  };
}

function plannedSplit(
  state: AppState,
  id: string,
  request: ReliefTwoSidedRequest,
): { readonly result: ReliefTwoSidedResult; readonly next?: Partial<AppState> } {
  const { project } = state;
  const machine = project.machine;
  if (machine?.kind !== 'cnc') {
    return { result: { kind: 'error', reason: 'Two-sided carving needs a CNC project.' } };
  }
  const relief = project.scene.objects.find((object) => object.id === id);
  if (relief?.kind !== 'relief' || relief.reliefSource.kind !== 'legacy-mesh') {
    return { result: { kind: 'error', reason: 'Select an STL relief to split.' } };
  }
  const mesh = relief as MeshReliefObject;
  const split = splitReliefForTwoSides(
    mesh.reliefSource.meshPositions,
    mesh.targetWidthMm,
    mesh.reliefDepthMm,
    { ...request, stockThicknessMm: machine.stock.thicknessMm },
  );
  if (split.kind === 'error') return { result: split };
  const sideA = sideRelief(mesh, split.sideA, split.insetMm, 'A');
  const sideB = sideRelief(mesh, split.sideB, split.insetMm, 'B');
  const objects = project.scene.objects.flatMap((object) =>
    object.id === id ? [sideA, sideB] : [object],
  );
  const scene = removeObjectIdsFromGroups(
    { ...project.scene, objects, layers: project.scene.layers.map(rebind(id, sideA.id)) },
    new Set([id]),
  );
  const enabled = project.cncSetup?.twoSided === undefined;
  const cncSetup = withSides(project.cncSetup, machine.stock, objects, id, sideA.id, sideB.id);
  return {
    result: {
      kind: 'ok',
      sideAId: sideA.id,
      sideBId: sideB.id,
      stockThicknessMm: split.stockThicknessMm,
      fitsStock: split.fitsStock,
      setupEnabled: enabled,
    },
    next: {
      project: { ...project, scene, cncSetup },
      selectedObjectId: sideA.id,
      additionalSelectedIds: new Set(),
      undoStack: pushUndo(project, state.undoStack),
      redoStack: [],
      dirty: true,
    },
  };
}

// The side's relief at the original's placement, moved so the model inside
// its frame lands exactly where the original model stood.
function sideRelief(
  original: MeshReliefObject,
  side: ReliefSideMesh,
  insetMm: number,
  name: 'A' | 'B',
): MeshReliefObject {
  const shift = applyTransform({ x: insetMm, y: insetMm }, { ...original.transform, x: 0, y: 0 });
  return {
    ...original,
    id: crypto.randomUUID(),
    source: `${original.source} (side ${name}, ${name === 'A' ? 'top' : 'bottom'})`,
    targetWidthMm: side.widthMm,
    reliefDepthMm: side.depthMm,
    reliefSource: { kind: 'legacy-mesh', meshPositions: side.positions, emptyCells: 'floor' },
    // The extent meshToHeightmap gives this mesh at this width.
    bounds: {
      minX: 0,
      minY: 0,
      maxX: side.widthMm,
      maxY: (side.heightMm / side.widthMm) * side.widthMm,
    },
    transform: {
      ...original.transform,
      x: original.transform.x - shift.x,
      y: original.transform.y - shift.y,
    },
  };
}

// A relief projection onto the original carries on onto the top side.
function rebind(from: string, to: string): (layer: Layer) => Layer {
  return (layer) => {
    const projection = layer.cnc?.reliefProjection;
    if (layer.cnc === undefined || projection?.reliefObjectId !== from) return layer;
    return {
      ...layer,
      cnc: { ...layer.cnc, reliefProjection: { ...projection, reliefObjectId: to } },
    };
  };
}

function withSides(
  setup: CncMachiningSetup | undefined,
  stock: CncStock,
  objects: ReadonlyArray<SceneObject>,
  originalId: string,
  sideAId: string,
  sideBId: string,
): CncMachiningSetup {
  const base = setup ?? defaultCncMachiningSetup();
  const current = base.twoSided;
  const without = (ids: ReadonlyArray<string>): ReadonlyArray<string> =>
    ids.filter((candidate) => candidate !== originalId);
  if (current === undefined) {
    return {
      ...base,
      twoSided: {
        activeSide: 'A',
        flipAxis: 'y',
        sideBStockOriginMm: stock.originOffset,
        sideAObjectIds: objects.filter((o) => o.id !== sideBId).map((o) => o.id),
        sideBObjectIds: [sideBId],
        registration: [],
      },
    };
  }
  return {
    ...base,
    twoSided: {
      ...current,
      sideAObjectIds: [...without(current.sideAObjectIds), sideAId],
      sideBObjectIds: [...without(current.sideBObjectIds), sideBId],
    },
  };
}
