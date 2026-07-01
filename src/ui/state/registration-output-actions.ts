// registration-output-actions — the two-run jig helper (ADR-057). Sets per-layer
// output so a single Start burns ONLY the registration box (run 1: burn the jig
// on scrap) or ONLY the artwork (run 2: burn the design, not the box). The box
// and the artwork must never burn in the same pass.

import { REGISTRATION_LAYER_ID, updateLayer, type Scene } from '../../core/scene';
import type { AppState } from './store';
import { pushUndo } from './scene-mutations';

export type RegistrationOutputScope = 'box' | 'artwork';

export type RegistrationOutputActions = {
  readonly setRegistrationOutput: (scope: RegistrationOutputScope) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function registrationOutputActions(set: Setter): RegistrationOutputActions {
  return {
    setRegistrationOutput: (scope) => set((state) => applyRegistrationOutput(state, scope)),
  };
}

function applyRegistrationOutput(
  state: AppState,
  scope: RegistrationOutputScope,
): AppState | Partial<AppState> {
  const snapshot =
    scope === 'box'
      ? captureArtworkOutputSnapshot(state.project.scene)
      : state.registrationArtworkOutputSnapshot;
  const scene = applyRegistrationOutputToScene(state.project.scene, scope, snapshot ?? undefined);
  if (scene === state.project.scene) return state;
  return {
    project: { ...state.project, scene },
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
