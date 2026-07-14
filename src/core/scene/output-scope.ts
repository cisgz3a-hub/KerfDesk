import type { Scene } from './scene';

const EMPTY_SELECTED_ARTWORK_MESSAGE =
  'Selected artwork only is enabled, but no artwork is selected. Select artwork or turn off Selected artwork only.';
const STALE_SELECTED_ARTWORK_MESSAGE =
  'Selected artwork only is enabled, but none of the selected artwork exists anymore. Select artwork or turn off Selected artwork only.';

export type OutputScope = {
  readonly cutSelectedGraphics: boolean;
  readonly useSelectionOrigin: boolean;
  readonly selectedObjectIds: ReadonlyArray<string>;
};

export type OutputScopeValidation =
  | { readonly ok: true; readonly scene: Scene }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

export const DEFAULT_OUTPUT_SCOPE: OutputScope = {
  cutSelectedGraphics: false,
  useSelectionOrigin: false,
  selectedObjectIds: [],
};

export function filterSceneForOutputScope(scene: Scene, scope: OutputScope): Scene {
  if (!scope.cutSelectedGraphics) return scene;
  const selected = new Set(scope.selectedObjectIds);
  return {
    ...scene,
    objects: scene.objects.filter((object) => selected.has(object.id)),
  };
}

export function validateOutputScope(scene: Scene, scope: OutputScope): OutputScopeValidation {
  if (!scope.cutSelectedGraphics) return { ok: true, scene };
  if (scope.selectedObjectIds.length === 0) {
    return {
      ok: false,
      messages: [EMPTY_SELECTED_ARTWORK_MESSAGE],
    };
  }
  const scoped = filterSceneForOutputScope(scene, scope);
  if (scoped.objects.length === 0) {
    return {
      ok: false,
      messages: [STALE_SELECTED_ARTWORK_MESSAGE],
    };
  }
  return { ok: true, scene: scoped };
}
