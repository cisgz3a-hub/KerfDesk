// One operation's settings edit, shared by `setLayerParam` and Job Review's
// Save. Save also writes the artworks that own an edited field (ADR-317), and
// both writes are one undo step (ADR-638 Amendment 2, audit 2026-10-21
// 06-P2-5): two steps let one Undo leave the owner reverted and the base not.
// The feed-ceiling Raise is the same pattern across Machine Setup: the Output
// max feed and the speed it makes room for are one step (ADR-361 Amendment 1).

import {
  updateLayer,
  type Layer,
  type ObjectOperationOverride,
  type Project,
} from '../../core/scene';
import { synchronizeCncTabCount } from './cnc-tab-count-sync';
import { deviceProfileChangeState } from './device-profile-change';
import { sceneWithModeSwitchRecipe } from './laser-recipe-seeding';
import { projectWithOperationOverride } from './object-properties-actions';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

export type LayerParamPatch = Partial<Omit<Layer, 'id' | 'color'>>;

export type ArtworkOverrideWrite = {
  readonly objectIds: ReadonlyArray<string>;
  readonly patch: ObjectOperationOverride;
};

/** Where an operation settings edit lands: the operation itself, or the
 * listed artworks' own settings for that operation. */
export type OperationSettingsOwner = {
  readonly operationId: string;
  readonly objectIds?: ReadonlyArray<string>;
};

export type LayerParamOwnerActions = {
  /** The operation patch, then each group of artworks that own an edited
   * field gets its part in their own settings, as one undo step. It does not
   * hide operations: `setLayerParam` also moves the selection for that. */
  readonly setLayerParamWithArtworkOverrides: (
    layerId: string,
    patch: Omit<LayerParamPatch, 'visible'>,
    artworkOverrides: ReadonlyArray<ArtworkOverrideWrite>,
  ) => void;
  /** Raises the machine's Output max feed to `speed` and writes `speed` where
   * `owner` says, as one undo step. The machine half is `updateDeviceProfile`'s
   * change, Machine Setup history context included. */
  readonly raiseOutputMaxFeedForSpeed: (speed: number, owner: OperationSettingsOwner) => void;
};

type AuthoringSet = (update: (state: AppState) => Partial<AppState>) => void;

export function layerParamOwnerActions(authoringSet: AuthoringSet): LayerParamOwnerActions {
  return {
    setLayerParamWithArtworkOverrides: (layerId, patch, artworkOverrides) =>
      authoringSet((s) => ({
        project: artworkOverrides.reduce(
          (current, owner) =>
            projectWithOperationOverride(current, new Set(owner.objectIds), owner.patch, layerId),
          projectWithLayerParam(s, layerId, patch),
        ),
        undoStack: pushUndo(s.project, s.undoStack),
        redoStack: [],
        dirty: true,
      })),
    raiseOutputMaxFeedForSpeed: (speed, owner) =>
      authoringSet((s) => {
        const raised = deviceProfileChangeState(s, { maxFeed: speed });
        const project =
          owner.objectIds === undefined
            ? projectWithLayerParam(
                { project: raised.project, materialLibrary: s.materialLibrary },
                owner.operationId,
                { speed },
              )
            : projectWithOperationOverride(
                raised.project,
                new Set(owner.objectIds),
                { speed },
                owner.operationId,
              );
        return {
          ...raised,
          project,
          undoStack: pushUndo(s.project, s.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
  };
}

/** `setLayerParam`'s project: the edit, its ADR-496 mode-switch reseed and
 * the CNC tab count it implies. */
export function projectWithLayerParam(
  s: Pick<AppState, 'project' | 'materialLibrary'>,
  layerId: string,
  patch: LayerParamPatch,
): Project {
  const updated = sceneWithModeSwitchRecipe(
    s.project,
    updateLayer(s.project.scene, layerId, patch),
    layerId,
    patch,
    s.materialLibrary,
  );
  return { ...s.project, scene: synchronizeCncTabCount(s.project.scene, updated, layerId) };
}
