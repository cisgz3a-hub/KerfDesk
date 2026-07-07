// object-insert-actions — the store slice that inserts a new SceneObject:
// import an SVG (with Phase C re-import-in-place), upsert a text object, or
// commit an on-canvas drawn shape (ADR-051, Phase G, B5). Extracted from
// store.ts so the root store stays under the file-size cap; all three share the
// same "add an object + auto-create layers + select + push undo" shape.

import {
  findRegistrationBoxes,
  type Layer,
  type Project,
  type SceneObject,
  type ShapeObject,
  type TextObject,
} from '../../core/scene';
import { applyInsertBoxPanels, type InsertablePart } from './box-insert-mutation';
import { createRegistrationBox, createRegistrationCircle } from '../../core/shapes';
import { applyLayerDefaultSettings } from '../layers/layer-default-settings';
import { seedLayerFromStockMaterial } from './cnc-project-material';
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
  applySetRegistrationBoxLocked,
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
  | 'insertBoxPanels'
  | 'addRegistrationBox'
  | 'addRegistrationCircle'
  | 'removeRegistrationBox'
  | 'setRegistrationBoxLocked'
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
    insertBoxPanels: (panels: ReadonlyArray<InsertablePart>) => {
      set((s) => applyInsertBoxPanels(s, panels) ?? s);
    },
    addRegistrationBox: (widthMm: number, heightMm: number) => {
      set((s) => {
        // Replace-in-place: keep an existing box's position and lock state so
        // resizing doesn't re-center it (the operator may have dragged it onto the
        // material) or silently unlock it. A fresh box centers on the bed.
        const existing = findRegistrationBoxes(s.project.scene)[0];
        const { bedWidth, bedHeight } = s.project.device;
        const position =
          existing === undefined
            ? registrationBoxDefaultPosition(bedWidth, bedHeight, widthMm, heightMm)
            : { x: existing.transform.x, y: existing.transform.y };
        const box = createRegistrationBox({ widthMm, heightMm, x: position.x, y: position.y });
        const next = existing?.locked === true ? { ...box, locked: true } : box;
        return applyAddRegistrationBox(s, next);
      });
    },
    addRegistrationCircle: (diameterMm: number) => {
      set((s) => {
        const existing = findRegistrationBoxes(s.project.scene)[0];
        const { bedWidth, bedHeight } = s.project.device;
        const position =
          existing === undefined
            ? registrationBoxDefaultPosition(bedWidth, bedHeight, diameterMm, diameterMm)
            : { x: existing.transform.x, y: existing.transform.y };
        const circle = createRegistrationCircle({
          diameterMm,
          x: position.x,
          y: position.y,
        });
        const next = existing?.locked === true ? { ...circle, locked: true } : circle;
        return applyAddRegistrationBox(s, next);
      });
    },
    removeRegistrationBox: () => {
      set((s) => applyRemoveRegistrationBox(s) ?? s);
    },
    setRegistrationBoxLocked: (locked: boolean) => {
      set((s) => applySetRegistrationBoxLocked(s, locked) ?? s);
    },
  };
}

function applyLayerDefaultsToFreshLayers<T extends { readonly project: Project }>(
  previousLayers: ReadonlyArray<Layer>,
  result: T,
  defaults: LayerDefaultsState,
): T {
  const existing = new Set(previousLayers.map((layer) => layer.id));
  const machine = result.project.machine;
  let changed = false;
  const layers = result.project.scene.layers.map((layer) => {
    if (existing.has(layer.id)) return layer;
    const settings = defaultSettingsForColor(defaults, layer.color);
    const withDefaults =
      Object.keys(settings).length === 0 ? layer : applyLayerDefaultSettings(layer, settings);
    // Seed fresh CNC layers from the project stock material (ADR-112); no-op
    // for laser or when no material is chosen.
    const seeded =
      machine?.kind === 'cnc' ? seedLayerFromStockMaterial(withDefaults, machine) : withDefaults;
    if (seeded !== layer) changed = true;
    return seeded;
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
