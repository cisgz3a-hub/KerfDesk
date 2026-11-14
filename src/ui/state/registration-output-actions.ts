// registration-output-actions — the two-run jig-set helper (ADR-057). The one
// registration operation owns every outline, so Outline only applies to the
// complete set. Artwork copies retain their source operations, so Artwork only
// applies to every copy while disabling every outline.

import {
  REGISTRATION_LAYER_ID,
  registrationRunState,
  updateLayer,
  type Project,
  type Scene,
} from '../../core/scene';
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
      ? outlineSnapshot(state.project.scene, existingSnapshot)
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

/** The artwork outputs Artwork only restores, when a jig's Outline only took a snapshot. */
export function registrationArtworkSnapshot(state: {
  readonly project: Project;
  readonly registrationArtworkOutputSnapshot?: Readonly<Record<string, boolean>> | null;
}): Readonly<Record<string, boolean>> | null {
  return (
    state.registrationArtworkOutputSnapshot ??
    state.project.registrationArtworkOutputSnapshot ??
    null
  );
}

/**
 * An operation cloned from jig artwork (an offset of the art, ADR-410
 * Amendment 6) restores what its source restores. Under Outline only the
 * source is off only because of the run toggle, and Artwork only turns back
 * on just the operations its snapshot names (tools audit T1, T33R-P2-1).
 * Returns the project and snapshot to store, or null when nothing changes.
 */
export function inheritRegistrationArtworkOutput<
  S extends {
    readonly project: Project;
    readonly registrationArtworkOutputSnapshot?: Readonly<Record<string, boolean>> | null;
  },
>(
  state: S,
  project: Project,
  clones: ReadonlyArray<{ readonly sourceId: string; readonly cloneId: string }>,
): {
  readonly project: Project;
  readonly registrationArtworkOutputSnapshot: Readonly<Record<string, boolean>>;
} | null {
  const snapshot = registrationArtworkSnapshot(state);
  if (snapshot === null) return null;
  const inherited = clones.filter(({ sourceId }) => snapshot[sourceId] !== undefined);
  if (inherited.length === 0) return null;
  const next: Record<string, boolean> = { ...snapshot };
  for (const { sourceId, cloneId } of inherited) next[cloneId] = snapshot[sourceId] === true;
  return {
    project: { ...project, registrationArtworkOutputSnapshot: next },
    registrationArtworkOutputSnapshot: next,
  };
}

// The artwork outputs Artwork only should restore after this Outline only.
function outlineSnapshot(
  scene: Scene,
  existing: Readonly<Record<string, boolean>> | null | undefined,
): Readonly<Record<string, boolean>> {
  // An artwork run the operator set up by hand since the last Outline only is
  // their current intent.
  if (existing == null || registrationRunState(scene) === 'artwork')
    return captureArtworkOutputSnapshot(scene);
  // Repeating Outline only keeps the snapshot it took, plus any artwork turned
  // on since; artwork that is off may only be off because of Outline only.
  const turnedOn = scene.layers.filter(
    (layer) => layer.id !== REGISTRATION_LAYER_ID && layer.output && existing[layer.id] !== true,
  );
  if (turnedOn.length === 0) return existing;
  const merged: Record<string, boolean> = { ...existing };
  for (const layer of turnedOn) merged[layer.id] = true;
  return merged;
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
