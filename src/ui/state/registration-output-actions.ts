// registration-output-actions — the two-run jig-set helper (ADR-057). The one
// registration operation owns every outline, so Outline only applies to the
// complete set. Artwork copies retain their source operations, so Artwork only
// applies to every copy while disabling every outline.

import { REGISTRATION_LAYER_ID, updateLayer, type Scene } from '../../core/scene';
import type { AppState } from './store';
import { pushUndo } from './scene-mutations';

export type RegistrationOutputScope = 'box' | 'artwork';

export type RegistrationOutputActions = {
  readonly setRegistrationOutput: (scope: RegistrationOutputScope) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export type RegistrationOutputState = Pick<
  AppState,
  'project' | 'registrationArtworkOutputSnapshot' | 'undoStack'
>;

export type RegistrationOutputResult = RegistrationOutputState &
  Partial<Pick<AppState, 'redoStack' | 'dirty'>>;

export function registrationOutputActions(set: Setter): RegistrationOutputActions {
  return {
    setRegistrationOutput: (scope) => set((state) => applyRegistrationOutput(state, scope)),
  };
}

export function applyRegistrationOutput(
  state: RegistrationOutputState,
  scope: RegistrationOutputScope,
): RegistrationOutputResult {
  if (!state.project.scene.layers.some((layer) => layer.id === REGISTRATION_LAYER_ID)) return state;
  const existingSnapshot =
    state.registrationArtworkOutputSnapshot ?? state.project.registrationArtworkOutputSnapshot;
  const snapshot =
    scope === 'box'
      ? (existingSnapshot ?? captureArtworkOutputSnapshot(state.project.scene))
      : (existingSnapshot ?? enableAllArtworkSnapshot(state.project.scene));
  const scene = applyRegistrationOutputToScene(state.project.scene, scope, snapshot);
  const persistedSnapshot = scope === 'box' ? snapshot : undefined;
  if (
    scene === state.project.scene &&
    state.project.registrationArtworkOutputSnapshot === persistedSnapshot
  )
    return state;
  const project = { ...state.project, scene };
  if (persistedSnapshot === undefined) delete project.registrationArtworkOutputSnapshot;
  else project.registrationArtworkOutputSnapshot = persistedSnapshot;
  return {
    project,
    registrationArtworkOutputSnapshot: scope === 'box' ? snapshot : null,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

export function applyRegistrationOutputToScene(
  initialScene: Scene,
  scope: RegistrationOutputScope,
  artworkOutputSnapshot?: Readonly<Record<string, boolean>>,
): Scene {
  const { layers } = initialScene;
  if (!layers.some((layer) => layer.id === REGISTRATION_LAYER_ID)) return initialScene;
  let scene = initialScene;
  for (const layer of layers) {
    const isRegistration = layer.id === REGISTRATION_LAYER_ID;
    const output =
      scope === 'box'
        ? isRegistration
        : isRegistration
          ? false
          : (artworkOutputSnapshot?.[layer.id] ?? layer.output);
    if (layer.output !== output) scene = updateLayer(scene, layer.id, { output });
  }
  return scene;
}

function captureArtworkOutputSnapshot(scene: Scene): Readonly<Record<string, boolean>> {
  const snapshot: Record<string, boolean> = {};
  for (const layer of scene.layers) {
    if (layer.id !== REGISTRATION_LAYER_ID) snapshot[layer.id] = layer.output;
  }
  return snapshot;
}

function enableAllArtworkSnapshot(scene: Scene): Readonly<Record<string, boolean>> {
  const snapshot: Record<string, boolean> = {};
  for (const layer of scene.layers) {
    if (layer.id !== REGISTRATION_LAYER_ID) snapshot[layer.id] = true;
  }
  return snapshot;
}
