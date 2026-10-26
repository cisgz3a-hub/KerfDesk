import { applySvgFragmentImport, applySvgFragmentReimport } from './svg-fragment-mutation';
// object-insert-actions — the store slice that inserts a new SceneObject:
// import an SVG (with Phase C re-import-in-place), upsert a text object, or
// commit an on-canvas drawn shape (ADR-051, Phase G, B5). Extracted from
// store.ts so the root store stays under the file-size cap; all three share the
// same "add an object + auto-create layers + select + push undo" shape.

import {
  findRegistrationBoxes,
  type EmbeddedFont,
  type SceneObject,
  type ShapeObject,
  type TextObject,
} from '../../core/scene';
import {
  applyInsertBoxPanels,
  cutFreshCncOperationsWithActiveBit,
  type InsertablePart,
  type InsertableSheet,
} from './box-insert-mutation';
import { applyCarveSettingsToOperations, applyDesignSketch } from './design-apply-mutation';
import { reportDependencyRepairs } from './object-delete-actions';
import { refuseSceneLimitOverrun } from './scene-copy-room';
import { validateDesignStudioDocument } from '../../io/project/project-design-studio-validator';
import { useToastStore } from './toast-store';
import { withReferencedEmbeddedFonts } from '../../core/text/embedded-font-set';
import { saveUndoStepName } from './undo-step-names';
import { prepareProjectInsertion, reportProjectInsertionFailure } from './project-insertion-budget';
import type { DesignApplyRecord } from './design-apply-record';
import { createRegistrationBox, createRegistrationCircle } from '../../core/shapes';
import { applyLayerDefaultsToFreshLayers, svgStructuralDefaults } from './fresh-operation-seeding';
import type { AppState } from './store';
import { fitAllObjects } from './viewport-actions';
import {
  applyFreshImport,
  applyReimport,
  applyUpsertText,
  type ImportOutcome,
  type TextInsertOptions,
} from './scene-mutations';
import { applyDrawShape } from './draw-shape-mutation';
import { applyImportBedFit } from './import-bed-fit';
import {
  applyAddRegistrationBox,
  applyRemoveRegistrationBox,
  applySetRegistrationBoxLocked,
  registrationBoxDefaultPosition,
} from './registration-box-actions';

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;
type Getter = () => AppState;

const DESIGN_FEWER = 'Apply a smaller drawing, or delete some objects first.';

export function objectInsertActions(
  rawSet: Setter,
  get: Getter,
): Pick<
  AppState,
  | 'importSvgObject'
  | 'importSvgFragment'
  | 'reimportSvgFragment'
  | 'reimportSvgObject'
  | 'upsertTextObject'
  | 'drawShape'
  | 'insertBoxPanels'
  | 'applyDesignSketch'
  | 'addRegistrationBox'
  | 'addRegistrationCircle'
  | 'removeRegistrationBox'
  | 'setRegistrationBoxLocked'
> {
  const importSet: Setter = (update) =>
    rawSet((state) => prepareProjectInsertion(state.project, () => update(state)));
  const set: Setter = (update) => reportProjectInsertionFailure(() => importSet(update));
  return {
    importSvgObject: importSvgObjectAction(importSet, get),
    ...svgFragmentActions(importSet, get),
    reimportSvgObject: reimportSvgObjectAction(importSet, get),
    upsertTextObject: upsertTextObjectAction(importSet),
    drawShape: drawShapeAction(set),
    insertBoxPanels: insertBoxPanelsAction(set),
    applyDesignSketch: applyDesignSketchAction(set),
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

function importSvgObjectAction(set: Setter, get: Getter): AppState['importSvgObject'] {
  return (object: SceneObject, batchOffsetIdx = 0): ImportOutcome => {
    let outcome: ImportOutcome = { kind: 'added' };
    set((state) => {
      const fitted = applyImportBedFit(
        applyLayerDefaultsToFreshLayers(
          state.project.scene.layers,
          applyFreshImport(state, object, batchOffsetIdx),
          state.layerDefaults,
          state.cncLiveCaps,
          state.materialLibrary,
        ),
      );
      outcome = fitted.outcome;
      return fitted.state;
    });
    // Auto-zoom to fit all objects — see viewport-actions.fitAllObjects.
    fitAllObjects(get);
    return outcome;
  };
}

function reimportSvgObjectAction(set: Setter, get: Getter): AppState['reimportSvgObject'] {
  return (targetObjectId, object) => {
    let outcome: ImportOutcome | null = null;
    set((state) => {
      const target = state.project.scene.objects.find(
        (candidate) => candidate.id === targetObjectId,
      );
      if (
        target === undefined ||
        target.kind !== 'imported-svg' ||
        target.libraryProvenance !== undefined ||
        object.kind !== 'imported-svg'
      ) {
        return state;
      }
      const next = applyReimport(state, target, object);
      outcome = next.outcome;
      return applyLayerDefaultsToFreshLayers(
        state.project.scene.layers,
        next.state,
        state.layerDefaults,
        state.cncLiveCaps,
        state.materialLibrary,
      );
    });
    if (outcome !== null) fitAllObjects(get);
    return outcome;
  };
}

function upsertTextObjectAction(set: Setter): AppState['upsertTextObject'] {
  return (text: TextObject, embeddedFont?: EmbeddedFont, options?: TextInsertOptions) => {
    set((state) =>
      applyLayerDefaultsToFreshLayers(
        state.project.scene.layers,
        applyTextAndEmbeddedFont(state, text, embeddedFont, options),
        state.layerDefaults,
        state.cncLiveCaps,
        state.materialLibrary,
      ),
    );
  };
}

function drawShapeAction(set: Setter): AppState['drawShape'] {
  return (shape: ShapeObject) => {
    set((state) =>
      applyLayerDefaultsToFreshLayers(
        state.project.scene.layers,
        applyDrawShape(state, shape),
        state.layerDefaults,
        state.cncLiveCaps,
        state.materialLibrary,
      ),
    );
  };
}

function insertBoxPanelsAction(set: Setter): AppState['insertBoxPanels'] {
  return (panels: ReadonlyArray<InsertablePart>, sheet: InsertableSheet) => {
    set((state) => {
      const next = applyInsertBoxPanels(state, panels, sheet);
      if (next === null) return state;
      const seeded = applyLayerDefaultsToFreshLayers(
        state.project.scene.layers,
        next,
        state.layerDefaults,
        state.cncLiveCaps,
        state.materialLibrary,
      );
      return cutFreshCncOperationsWithActiveBit(
        state.project.scene.layers,
        seeded,
        state.cncLiveCaps,
      );
    });
  };
}

function applyDesignSketchAction(set: Setter): AppState['applyDesignSketch'] {
  return (sketch, ids, previous, view) => {
    // The record has to reach the Studio, and a zustand setter returns nothing,
    // so it is captured here and returned once the transition has run.
    let record: DesignApplyRecord | 'refused' | null = null;
    set((state) => {
      const restoreUndoName = saveUndoStepName(state.project);
      const next = applyDesignSketch(state, sketch, ids, previous, view);
      // A sketch that contributes nothing leaves the project exactly as it was.
      if (next === null) return state;
      const sourceError = validateDesignStudioDocument(next.project.designStudioDocument);
      if (sourceError !== null) {
        restoreUndoName();
        useToastStore
          .getState()
          .pushToast(`The drawing could not be applied: ${sourceError}.`, 'warning');
        record = 'refused';
        return state;
      }
      // A project past its limits saves but cannot be opened again (ADR-307
      // amendment 1): such an Apply is refused whole, and the Studio is told.
      if (refuseSceneLimitOverrun(state.project.scene, next.project.scene, DESIGN_FEWER)) {
        restoreUndoName();
        record = 'refused';
        return state;
      }
      record = next.applyRecord;
      const { dependencyRepairs, ...nextState } = next;
      reportDependencyRepairs(dependencyRepairs);
      // Defaults first, then the design layers' carve settings — the reverse
      // order would let the defaults pass clobber the depth/bit the operator
      // just saw in the Studio's 3D preview (ADR-272 Amendment 1 clause 2).
      const withDefaults = applyLayerDefaultsToFreshLayers(
        state.project.scene.layers,
        nextState,
        state.layerDefaults,
        state.cncLiveCaps,
        state.materialLibrary,
      );
      return applyCarveSettingsToOperations(withDefaults, next.carveOperations);
    });
    return record;
  };
}

// ADR-628 Amendment 1: a font with the same bytes as one already embedded is
// reused under that key, a font nothing names any more leaves with the commit
// (undo restores the whole previous project, fonts included), and a commit
// that would leave more fonts than a project can hold changes nothing.
function applyTextAndEmbeddedFont(
  state: AppState,
  text: TextObject,
  embeddedFont?: EmbeddedFont,
  options?: TextInsertOptions,
) {
  const existing = state.project.embeddedFonts ?? [];
  const same =
    embeddedFont === undefined
      ? undefined
      : existing.find(
          (font) => font.dataBase64 === embeddedFont.dataBase64 && font.key !== embeddedFont.key,
        );
  const placed =
    same !== undefined && text.fontKey === embeddedFont?.key
      ? { ...text, fontKey: same.key }
      : text;
  const next = applyUpsertText(state, placed, options);
  const embeddedFonts =
    embeddedFont === undefined || same !== undefined
      ? next.project.embeddedFonts
      : [
          ...(next.project.embeddedFonts ?? []).filter((font) => font.key !== embeddedFont.key),
          embeddedFont,
        ];
  const project = withReferencedEmbeddedFonts(
    embeddedFonts === undefined ? next.project : { ...next.project, embeddedFonts },
  );
  // The shared insertion guard refuses an over-budget project by throwing.
  // Text editors catch that refusal and retain the draft for correction.
  return { ...next, project };
}

function svgFragmentActions(
  set: Setter,
  get: Getter,
): Pick<AppState, 'importSvgFragment' | 'reimportSvgFragment'> {
  return {
    importSvgFragment: (fragment, batchIndex = 0) => {
      let outcome: ImportOutcome = { kind: 'added' };
      set((state) => {
        const fitted = applyImportBedFit(
          applyLayerDefaultsToFreshLayers(
            state.project.scene.layers,
            applySvgFragmentImport(state, fragment, batchIndex),
            svgStructuralDefaults(state.layerDefaults),
            state.cncLiveCaps,
            state.materialLibrary,
          ),
        );
        outcome = fitted.outcome;
        return fitted.state;
      });
      fitAllObjects(get);
      return outcome;
    },
    reimportSvgFragment: (targetId, fragment) => {
      let outcome: ImportOutcome | null = null;
      set((state) => {
        const next = applySvgFragmentReimport(state, targetId, fragment);
        if (next === null) return state;
        outcome = next.outcome;
        return applyLayerDefaultsToFreshLayers(
          state.project.scene.layers,
          next.state,
          svgStructuralDefaults(state.layerDefaults),
          state.cncLiveCaps,
          state.materialLibrary,
        );
      });
      if (outcome !== null) fitAllObjects(get);
      return outcome;
    },
  };
}
