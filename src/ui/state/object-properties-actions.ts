import type { Project } from '../../core/scene';
import { pushUndo, type StateSlice } from './scene-mutations';

const MIN_POWER_SCALE_PERCENT = 0;
const MAX_POWER_SCALE_PERCENT = 100;

type ObjectPropertiesState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

type ObjectPropertiesMutation =
  | {
      readonly project: Project;
      readonly undoStack: ReadonlyArray<Project>;
      readonly redoStack: ReadonlyArray<Project>;
      readonly dirty: true;
    }
  | Record<string, never>;

type ObjectPropertiesSet = (fn: (state: ObjectPropertiesState) => ObjectPropertiesMutation) => void;

export type ObjectPropertiesActions = {
  readonly setSelectedObjectsPowerScale: (powerScale: number) => void;
};

export function objectPropertiesActions(set: ObjectPropertiesSet): ObjectPropertiesActions {
  return {
    setSelectedObjectsPowerScale: (powerScale) =>
      set((state) => {
        const ids = selectedObjectIds(state);
        if (ids.size === 0) return {};
        const clamped = clampPowerScale(powerScale);
        let changed = false;
        const objects = state.project.scene.objects.map((object) => {
          if (!ids.has(object.id)) return object;
          if ((object.powerScale ?? MAX_POWER_SCALE_PERCENT) === clamped) return object;
          changed = true;
          return { ...object, powerScale: clamped };
        });
        if (!changed) return {};
        return {
          project: { ...state.project, scene: { ...state.project.scene, objects } },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
  };
}

function selectedObjectIds(state: ObjectPropertiesState): Set<string> {
  return new Set([
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ]);
}

function clampPowerScale(value: number): number {
  if (!Number.isFinite(value)) return MAX_POWER_SCALE_PERCENT;
  return Math.max(MIN_POWER_SCALE_PERCENT, Math.min(MAX_POWER_SCALE_PERCENT, value));
}
