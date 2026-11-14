// Which operation a rubber-band outline cuts with (ADR-480 Amendment 7). The
// outline is a cut around the selection, so it may only copy an operation that
// cuts along a line: a Line operation whose enabled sub-operations are Line
// too, and in CNC a Profile. A Fill sub-operation would hatch the whole hull,
// and a CNC Pocket or V-carve (every CNC operation has mode Line) would clear
// it (tools audit T34-P1-1, T34R-P2-1). Anything else gets the new "Outline"
// operation, an Outside-path profile in CNC so the bit stays off the parts the
// hull touches. The copy keeps the source artwork's own settings and power
// scale, as Offset Shapes does (T34-P2-1), and the user picks it in the dialog.

import {
  addLayer,
  createArtworkOperation,
  cutTypeLabel,
  DEFAULT_CNC_LAYER_SETTINGS,
  layerFromSubLayer,
  machineKindOf,
  primaryOperationForObject,
  type ImportedSvg,
  type Layer,
  type MachineConfig,
  type Project,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { effectiveOperationForObject } from '../../core/effective-output';
import { geometryToolSkippedNotice, geometryToolSources } from './geometry-tool-sources';
import { prepareIndependentArtwork } from './vector-path-actions';

/** The choice that gives the outline a new operation named Outline. */
export const NEW_OUTLINE_OPERATION_ID = 'new-outline-operation';
export const OUTLINE_OPERATION_NAME = 'Outline';

export type OutlineOperationChoice = {
  readonly id: string;
  readonly name: string;
  /** What the operation does: "Line", or the CNC cut type. */
  readonly cut: string;
  readonly output: boolean;
  /** The selected artwork whose operation and settings are copied; null for a new operation. */
  readonly source: SceneObject | null;
};

export type RubberBandOutlineOptions = {
  /** The selected objects the outline goes round, in the order they were selected. */
  readonly sources: ReadonlyArray<SceneObject>;
  readonly choices: ReadonlyArray<OutlineOperationChoice>;
  readonly defaultId: string;
  /** Names of selected operations the outline may not copy. */
  readonly passedOver: ReadonlyArray<string>;
  /** What the outline leaves out (variable data); empty when nothing. */
  readonly leftOut: string;
  readonly leftOutCount: number;
};

/** The outline's sources and the operations it may cut with. */
export function rubberBandOutlineOptions(
  project: Project,
  selectedIds: ReadonlyArray<string>,
): RubberBandOutlineOptions {
  const byId = new Map(project.scene.objects.map((object) => [object.id, object]));
  const selected = [...new Set(selectedIds)].flatMap((id) => {
    const object = byId.get(id);
    return object === undefined ? [] : [object];
  });
  // Variable data's stored outlines are its template, not the burned value, so
  // the outline leaves it out (ADR-350 Amendment 2).
  const { kept, skipped } = geometryToolSources(project.scene, selected, 'variable');
  const leftOutCount = skipped.variableText + skipped.variableBarcode + skipped.jig;
  const notice = geometryToolSkippedNotice(skipped);
  const leftOut =
    notice === ''
      ? ''
      : `${notice} The outline does not go round ${leftOutCount === 1 ? 'it' : 'them'}.`;
  const cnc = machineKindOf(project.machine) === 'cnc';
  const choices: OutlineOperationChoice[] = [];
  const passedOver: string[] = [];
  for (const source of kept) {
    const operation = primaryOperationForObject(source, project.scene.layers);
    if (operation === null) continue;
    if (choices.some((choice) => choice.id === operation.id)) continue;
    if (!cutsAlongTheOutline(operation, cnc)) {
      if (!passedOver.includes(operation.name)) passedOver.push(operation.name);
      continue;
    }
    choices.push({
      id: operation.id,
      name: operation.name,
      cut: cutName(operation, cnc),
      output: effectiveOperationForObject(operation, source).output,
      source,
    });
  }
  const fresh: OutlineOperationChoice = {
    id: NEW_OUTLINE_OPERATION_ID,
    name: OUTLINE_OPERATION_NAME,
    cut: cnc ? cutTypeLabel('profile-outside') : 'Line',
    output: true,
    source: null,
  };
  const defaultId = choices.find((choice) => choice.output)?.id ?? NEW_OUTLINE_OPERATION_ID;
  return {
    sources: kept,
    choices: [...choices, fresh],
    defaultId,
    passedOver,
    leftOut,
    leftOutCount,
  };
}

/** A Line operation with only Line sub-operations; in CNC, a Profile. */
export function cutsAlongTheOutline(operation: Layer, cnc: boolean): boolean {
  if (operation.mode !== 'line') return false;
  if (cnc && !(operation.cnc ?? DEFAULT_CNC_LAYER_SETTINGS).cutType.startsWith('profile')) {
    return false;
  }
  return operation.subLayers.every(
    (subLayer) => !subLayer.enabled || layerFromSubLayer(operation, subLayer).mode === 'line',
  );
}

function cutName(operation: Layer, cnc: boolean): string {
  return cnc ? cutTypeLabel((operation.cnc ?? DEFAULT_CNC_LAYER_SETTINGS).cutType) : 'Line';
}

/** One option of the dialog's operation list. */
export function outlineChoiceLabel(choice: OutlineOperationChoice): string {
  const output = choice.output ? '' : ', output off';
  return choice.source === null
    ? `New operation “${choice.name}” (${choice.cut})`
    : `${choice.name} (${choice.cut}${output})`;
}

/** Add the outline's operation to the scene and bind the outline to it. */
export function bindOutlineToChoice(
  scene: Scene,
  machine: MachineConfig | undefined,
  outline: ImportedSvg,
  choice: OutlineOperationChoice,
): { readonly scene: Scene; readonly object: SceneObject } {
  const source = choice.source;
  if (source === null) {
    const seed = createArtworkOperation(scene, outline, {
      mode: 'line',
      name: OUTLINE_OPERATION_NAME,
    });
    const operation: Layer =
      machineKindOf(machine) === 'cnc'
        ? { ...seed.operation, cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-outside' } }
        : seed.operation;
    return { scene: addLayer(scene, operation), object: seed.object };
  }
  // The source's own settings and power scale go with the copy, as Offset
  // Shapes keeps them (offset-shapes.ts resultObject).
  const withSettings: ImportedSvg = {
    ...outline,
    ...(source.powerScale === undefined ? {} : { powerScale: source.powerScale }),
    ...(source.operationOverride === undefined
      ? {}
      : { operationOverride: source.operationOverride }),
  };
  return prepareIndependentArtwork(scene, withSettings, source);
}
