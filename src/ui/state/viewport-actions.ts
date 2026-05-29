// Viewport-related actions on the project store that need access to
// AppState (for selection + scene + device bed). They reach into the
// UI store to dispatch zoomToBounds because the viewport's
// zoomFactor/pan lives there — keeping store.ts under the 400-line
// hard cap.
//
// Pattern mirrors detected-settings-action.ts: a thin action factory
// the main store spreads into useStore.

import { combinedBBox, type SceneObject } from '../../core/scene';
import { useUiStore } from './ui-store';

// Minimal slice of AppState this action reads. Restated locally to
// avoid the store.ts ↔ this-file circular import that
// `import type { AppState }` would otherwise create. Exported so the
// sibling import-actions.ts can type its `get` the same way.
export type ProjectSlice = {
  readonly project: {
    readonly device: { readonly bedWidth: number; readonly bedHeight: number };
    readonly scene: { readonly objects: ReadonlyArray<SceneObject> };
  };
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

// Three-tier fallback so Shift+F always does *something* useful:
//   1. Selection bounds when there's a non-empty selection.
//   2. All-objects bounds when nothing's selected (acts like a
//      "Zoom to drawing" command).
//   3. resetView() when the scene is empty (fits the bed — same as
//      plain F).
// Fit the viewport to every object in the scene. Called from
// importSvgObjectAction so a freshly imported design lands visible
// instead of disappearing as a tiny shape on a 400 mm bed. No-op
// when the scene is empty (no sensible target).
export function fitAllObjects(get: () => ProjectSlice): void {
  const s = get();
  const bbox = combinedBBox(s.project.scene.objects);
  if (bbox === null) return;
  useUiStore.getState().zoomToBounds(bbox, s.project.device.bedWidth, s.project.device.bedHeight);
}

export function fitToSelection(get: () => ProjectSlice): void {
  const s = get();
  const ids = new Set<string>([
    ...(s.selectedObjectId !== null ? [s.selectedObjectId] : []),
    ...s.additionalSelectedIds,
  ]);
  const targets =
    ids.size > 0 ? s.project.scene.objects.filter((o) => ids.has(o.id)) : s.project.scene.objects;
  const bbox = combinedBBox(targets);
  if (bbox === null) {
    useUiStore.getState().resetView();
    return;
  }
  useUiStore.getState().zoomToBounds(bbox, s.project.device.bedWidth, s.project.device.bedHeight);
}
