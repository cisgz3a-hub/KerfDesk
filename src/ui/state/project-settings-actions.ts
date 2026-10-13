import { projectNotesActions, type ProjectNotesActions } from './project-notes-actions';
import {
  projectOptimizationActions,
  type ProjectOptimizationActions,
} from './project-optimization-actions';
import {
  projectStartPointActions,
  type ProjectStartPointActions,
} from './project-start-point-actions';
import type { AppState } from './store';

export type ProjectSettingsActions = ProjectNotesActions &
  ProjectOptimizationActions &
  ProjectStartPointActions;

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function projectSettingsActions(set: Setter): ProjectSettingsActions {
  return {
    ...projectNotesActions(set),
    ...projectOptimizationActions(set),
    ...projectStartPointActions(set),
  };
}
