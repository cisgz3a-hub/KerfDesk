import type { AppState } from './store';
import {
  registrationJigSetActions,
  type RegistrationJigSetActions,
} from './registration-jig-set-actions';
import {
  registrationJigArtworkActions,
  type RegistrationJigArtworkActions,
} from './registration-jig-artwork-actions';
import {
  registrationOutputActions,
  type RegistrationOutputActions,
} from './registration-output-actions';

export type RegistrationActions = RegistrationJigSetActions &
  RegistrationJigArtworkActions &
  RegistrationOutputActions;

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function registrationActions(set: Setter): RegistrationActions {
  return {
    ...registrationJigSetActions(set),
    ...registrationJigArtworkActions(set),
    ...registrationOutputActions(set),
  };
}
