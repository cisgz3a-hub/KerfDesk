// setReliefParams — edit a ReliefObject's carve parameters (width / depth /
// source interpretation), the editor promised when H.5 roughing landed. Width edits
// keep canonical heightfield bounds synchronized with their resolved physical
// dimensions; legacy meshes retain stored natural-bounds aspect and intrinsic
// mesh CAM. When an exact common factor exists, either representation re-expresses
// local dimensions and scale together while keeping every transformed corner unchanged.

import type { AppState } from './store';
import { pushUndo } from './scene-mutations';
import {
  hasReliefPatch,
  isNoOpHeightfieldMappingPatch,
  normalizeReliefPatch,
} from './relief-heightfield-param-patch';
import { applyReliefParamPatch } from './relief-param-patch-application';

export type { ReliefParamPatch } from './relief-heightfield-param-patch';

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function reliefParamActions(set: Setter): Pick<AppState, 'setReliefParams'> {
  return {
    setReliefParams: (id, patch) => {
      const normalized = normalizeReliefPatch(patch);
      if (!hasReliefPatch(normalized)) return;
      set((s) => {
        let changed = false;
        const objects = s.project.scene.objects.map((obj) => {
          if (obj.id !== id || obj.kind !== 'relief') return obj;
          if (isNoOpHeightfieldMappingPatch(obj, normalized)) return obj;
          changed = true;
          return applyReliefParamPatch(obj, normalized);
        });
        if (!changed) return s;
        return {
          project: { ...s.project, scene: { ...s.project.scene, objects } },
          undoStack: pushUndo(s.project, s.undoStack),
          redoStack: [],
          dirty: true,
        };
      });
    },
  };
}
