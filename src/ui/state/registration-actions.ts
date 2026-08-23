import type { AppState } from './store';
import {
  registrationJigSetActions,
  type RegistrationJigSetActions,
} from './registration-jig-set-actions';
import {
  registrationOutputActions,
  type RegistrationOutputActions,
} from './registration-output-actions';

export type RegistrationActions = RegistrationJigSetActions & RegistrationOutputActions;

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function registrationActions(set: Setter): RegistrationActions {
  return { ...registrationJigSetActions(set), ...registrationOutputActions(set) };
}
