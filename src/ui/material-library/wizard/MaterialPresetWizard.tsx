// The guided create/edit material preset wizard (ADR-093, F-ML2). A draft-commit
// Dialog: identity -> cut settings -> details -> review, committing to the active
// library only on the final Save. Settings/details are uncontrolled and read
// from FormData on each Next (reusing the layer cut-settings reader); identity is
// controlled in the reducer so Back/Next preserve it.

import { useReducer } from 'react';
import type { DeviceProfile } from '../../../core/devices';
import { assertNever } from '../../../core/scene';
import type { MaterialPreset } from '../../../io/material-library';
import { Button, Dialog, DialogActions } from '../../kit';
import { useStore } from '../../state';
import { WizardCutSettingsStep } from './WizardCutSettingsStep';
import { WizardDetailsStep } from './WizardDetailsStep';
import { WizardIdentityStep } from './WizardIdentityStep';
import { WizardReviewStep } from './WizardReviewStep';
import {
  buildPreset,
  defaultRecipe,
  identityFromPreset,
  nextPresetId,
  readRecipeFromForm,
} from './wizard-recipe';
import {
  EMPTY_IDENTITY,
  identityComplete,
  initialWizardState,
  stepHeading,
  stepNumber,
  WIZARD_STEPS,
  wizardReducer,
  type IdentityDraft,
  type WizardState,
} from './wizard-state';

const EMPTY_ENTRIES: ReadonlyArray<MaterialPreset> = [];

export function MaterialPresetWizard(props: {
  readonly existingPreset?: MaterialPreset | null;
  readonly onClose: () => void;
  readonly onSaved?: (id: string) => void;
}): JSX.Element {
  const existing = props.existingPreset ?? null;
  const entries = useStore((s) => s.materialLibrary?.entries ?? EMPTY_ENTRIES);
  const device = useStore((s) => s.project.device);
  const upsertMaterialPreset = useStore((s) => s.upsertMaterialPreset);
  const [state, dispatch] = useReducer(wizardReducer, existing, seedState);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (state.step === 'identity') {
      if (identityComplete(state.identity)) dispatch({ kind: 'next' });
      return;
    }
    if (state.step === 'settings' || state.step === 'details') {
      dispatch({
        kind: 'set-recipe',
        recipe: readRecipeFromForm(event.currentTarget, state.recipe),
      });
      dispatch({ kind: 'next' });
      return;
    }
    save(existing, state, entries, upsertMaterialPreset, props.onSaved);
    props.onClose();
  };

  const nextDisabled = state.step === 'identity' && !identityComplete(state.identity);
  return (
    <Dialog
      onClose={props.onClose}
      as="form"
      onSubmit={handleSubmit}
      size="md"
      ariaLabel={existing === null ? 'New material preset' : 'Edit material preset'}
    >
      <header style={headerStyle}>
        <h2 className="lf-dialog-title">{existing === null ? 'New material' : 'Edit material'}</h2>
        <p className="lf-subheading">
          Step {stepNumber(state.step)} of {WIZARD_STEPS.length} — {stepHeading(state.step)}
        </p>
      </header>
      <WizardStepBody
        state={state}
        device={device}
        existing={existing}
        onIdentityChange={(identity) => dispatch({ kind: 'set-identity', identity })}
      />
      <DialogActions>
        {state.step === 'identity' ? null : (
          <Button onClick={() => dispatch({ kind: 'back' })}>Back</Button>
        )}
        <Button onClick={props.onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={nextDisabled}>
          {state.step === 'review' ? 'Save' : 'Next'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function WizardStepBody(props: {
  readonly state: WizardState;
  readonly device: DeviceProfile;
  readonly existing: MaterialPreset | null;
  readonly onIdentityChange: (identity: IdentityDraft) => void;
}): JSX.Element {
  switch (props.state.step) {
    case 'identity':
      return (
        <WizardIdentityStep identity={props.state.identity} onChange={props.onIdentityChange} />
      );
    case 'settings':
      return <WizardCutSettingsStep recipe={props.state.recipe} />;
    case 'details':
      return <WizardDetailsStep recipe={props.state.recipe} />;
    case 'review':
      return (
        <WizardReviewStep
          identity={props.state.identity}
          recipe={props.state.recipe}
          device={props.device}
          existing={props.existing}
        />
      );
    default:
      return assertNever(props.state.step, 'wizard step');
  }
}

function save(
  existing: MaterialPreset | null,
  state: WizardState,
  entries: ReadonlyArray<MaterialPreset>,
  upsertMaterialPreset: (preset: MaterialPreset) => boolean,
  onSaved: ((id: string) => void) | undefined,
): void {
  const id =
    existing?.id ?? nextPresetId(state.identity, new Set(entries.map((entry) => entry.id)));
  const preset = buildPreset({
    identity: state.identity,
    recipe: state.recipe,
    existing,
    id,
    revision: `manual-${Date.now()}`,
  });
  if (upsertMaterialPreset(preset)) onSaved?.(id);
}

function seedState(existing: MaterialPreset | null): WizardState {
  return initialWizardState({
    identity: existing === null ? EMPTY_IDENTITY : identityFromPreset(existing),
    recipe: existing === null ? defaultRecipe() : existing.recipe,
  });
}

const headerStyle: React.CSSProperties = { marginBottom: 8 };
