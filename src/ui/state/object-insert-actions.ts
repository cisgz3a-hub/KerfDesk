// object-insert-actions — the store slice that inserts a new SceneObject:
// import an SVG (with Phase C re-import-in-place), upsert a text object, or
// commit an on-canvas drawn shape (ADR-051, Phase G, B5). Extracted from
// store.ts so the root store stays under the file-size cap; all three share the
// same "add an object + auto-create layers + select + push undo" shape.

import {
  type Layer,
  type Project,
  type SceneObject,
  type ShapeObject,
  type TextObject,
} from '../../core/scene';
import { createRegistrationBox } from '../../core/shapes';
import { applyLayerDefaultSettings } from '../layers/layer-default-settings';
import { defaultSettingsForColor, type LayerDefaultsState } from './layer-default-actions';
import type { AppState } from './store';
import { fitAllObjects } from './viewport-actions';
import {
  applyFreshImport,
  applyReimport,
  applyUpsertText,
  findReimportTarget,
  type ImportOutcome,
} from './scene-mutations';
import { applyDrawShape } from './draw-shape-mutation';
import {
  applyAddRegistrationBox,
  applyRemoveRegistrationBox,
  registrationBoxDefaultPosition,
} from './registration-box-actions';

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;
type Getter = () => AppState;

export function objectInsertActions(
  set: Setter,
  get: Getter,
): Pick<
  AppState,
  | 'importSvgObject'
  | 'upsertTextObject'
  | 'drawShape'
  | 'addRegistrationBox'
  | 'removeRegistrationBox'
> {
  return {
    importSvgObject: (object: SceneObject, batchOffsetIdx = 0): ImportOutcome => {
      const existing = findReimportTarget(get().project.scene, object);
      let outcome: ImportOutcome = { kind: 'added' };
      set((s) => {
        if (existing !== null && object.kind === 'imported-svg') {
          const next = applyReimport(s, existing, object);
          outcome = next.outcome;
          return next.state;
        }
        return applyLayerDefaultsToFreshLayers(
          s.project.scene.layers,
          applyFreshImport(s, object, batchOffsetIdx),
          s.layerDefaults,
        );
      });
      // Auto-zoom to fit all objects — see viewport-actions.fitAllObjects.
      fitAllObjects(get);
      return outcome;
    },
    upsertTextObject: (text: TextObject) => {
      set((s) => applyUpsertText(s, text));
    },
    drawShape: (shape: ShapeObject) => {
      set((s) => applyDrawShape(s, shape));
    },
    addRegistrationBox: (widthMm: number, heightMm: number) => {
      set((s) => {
        const { bedWidth, bedHeight } = s.project.device;
        const position = registrationBoxDefaultPosition(bedWidth, bedHeight, widthMm, heightMm);
        const box = createRegistrationBox({ widthMm, heightMm, x: position.x, y: position.y });
        return applyAddRegistrationBox(s, box);
      });
    },
    removeRegistrationBox: () => {
      set((s) => applyRemoveRegistrationBox(s) ?? s);
    },
  };
}

function applyLayerDefaultsToFreshLayers<T extends { readonly project: Project }>(
  previousLayers: ReadonlyArray<Layer>,
  result: T,
  defaults: LayerDefaultsState,
): T {
  const existing = new Set(previousLayers.map((layer) => layer.id));
  let changed = false;
  const layers = result.project.scene.layers.map((layer) => {
    if (existing.has(layer.id)) return layer;
    const settings = defaultSettingsForColor(defaults, layer.color);
    if (Object.keys(settings).length === 0) return layer;
    changed = true;
    return applyLayerDefaultSettings(layer, settings);
  });
  if (!changed) return result;
  return {
    ...result,
    project: {
      ...result.project,
      scene: { ...result.project.scene, layers },
    },
  };
}
