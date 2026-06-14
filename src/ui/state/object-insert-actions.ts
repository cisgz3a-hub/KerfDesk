// object-insert-actions — the store slice that inserts a new SceneObject:
// import an SVG (with Phase C re-import-in-place), upsert a text object, or
// commit an on-canvas drawn shape (ADR-051, Phase G, B5). Extracted from
// store.ts so the root store stays under the file-size cap; all three share the
// same "add an object + auto-create layers + select + push undo" shape.

import { type SceneObject, type ShapeObject, type TextObject } from '../../core/scene';
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

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;
type Getter = () => AppState;

export function objectInsertActions(
  set: Setter,
  get: Getter,
): Pick<AppState, 'importSvgObject' | 'upsertTextObject' | 'drawShape'> {
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
        return applyFreshImport(s, object, batchOffsetIdx);
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
  };
}
