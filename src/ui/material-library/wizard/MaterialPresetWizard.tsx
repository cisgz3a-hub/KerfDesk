// The guided create/edit material preset wizard (ADR-093, F-ML2). A draft-commit
// Dialog: identity -> cut settings -> details -> review, committing to the active
// library only on the final Save. Settings/details are uncontrolled and read
// from FormData on Back and Next (reusing the layer cut-settings reader); identity is
// controlled in the reducer so Back/Next preserve it.

import { useReducer } from 'react';
import type { DeviceProfile } from '../../../core/devices';
import { assertNever } from '../../../core/scene';
import type { MaterialPreset } from '../../../io/material-library';
import { Button, Dialog, DialogActions } from '../../kit';
import { useStore } from '../../state';
import { useToastStore } from '../../state/toast-store';
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
import type { MaterialPresetWizardSeed } from './wizard-seed';
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
  /** Prefill for a new preset (ADR-381); ignored when editing. */
  readonly seed?: MaterialPresetWizardSeed;
  readonly onClose: () => void;
  readonly onSaved?: (id: string) => void;
}): JSX.Element {
  const existing = props.existingPreset ?? null;
  const seed = existing === null ? props.seed : undefined;
  const entries = useStore((s) => s.materialLibrary?.entries ?? EMPTY_ENTRIES);
  const device = useStore((s) => s.project.device);
  const upsertMaterialPreset = useStore((s) => s.upsertMaterialPreset);
  const [state, dispatch] = useReducer(wizardReducer, { existing, seed }, seedState);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (state.step === 'identity') {
      if (identityComplete(state.identity)) dispatch({ kind: 'next' });
      return;
    }
    if (state.step === 'settings' || state.step === 'details') {
      dispatch({
        kind: 'set-recipe',
        recipe: readRecipeFromForm(event.currentTarget, state.recipe, state.step),
      });
      dispatch({ kind: 'next' });
      return;
    }
    save({ existing, seed, state, entries, upsertMaterialPreset, onSaved: props.onSaved });
    props.onClose();
  };

  const nextDisabled = state.step === 'identity' && !identityComplete(state.identity);
  const handleBack = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const form = event.currentTarget.form;
    if (form !== null && (state.step === 'settings' || state.step === 'details')) {
      dispatch({ kind: 'set-recipe', recipe: readRecipeFromForm(form, state.recipe, state.step) });
    }
    dispatch({ kind: 'back' });
  };
  return (
    <Dialog
      onClose={props.onClose}
      as="form"
      onSubmit={handleSubmit}
      size="md"
      ariaLabel={existing === null ? 'New material preset' : 'Edit material preset'}
    >
      <header style={headerStyle}>
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
        >
          <h2 className="lf-dialog-title">
            {existing === null ? 'New material' : 'Edit material'}
          </h2>
        </div>
        <p className="lf-subheading">
          Step {stepNumber(state.step)} of {WIZARD_STEPS.length} — {stepHeading(state.step)}
        </p>
        {seed === undefined ? null : <p className="lf-subheading">{seed.source}</p>}
      </header>
      <WizardStepBody
        state={state}
        device={device}
        existing={existing}
        onIdentityChange={(identity) => dispatch({ kind: 'set-identity', identity })}
      />
      <DialogActions>
        {state.step === 'identity' ? null : <Button onClick={handleBack}>Back</Button>}
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

function save(args: {
  readonly existing: MaterialPreset | null;
  readonly seed: MaterialPresetWizardSeed | undefined;
  readonly state: WizardState;
  readonly entries: ReadonlyArray<MaterialPreset>;
  readonly upsertMaterialPreset: (preset: MaterialPreset) => boolean;
  readonly onSaved: ((id: string) => void) | undefined;
}): void {
  const { existing, seed, state } = args;
  const id =
    existing?.id ?? nextPresetId(state.identity, new Set(args.entries.map((entry) => entry.id)));
  const preset = buildPreset({
    identity: state.identity,
    recipe: state.recipe,
    existing,
    id,
    revision: `manual-${Date.now()}`,
  });
  // A prefilled preset can start from the canvas before any library exists;
  // it then gets one named after the machine, like the Saved Libraries page.
  if (seed !== undefined) ensureActiveLibrary();
  if (!args.upsertMaterialPreset({ ...preset, ...seed?.metadata })) return;
  args.onSaved?.(id);
  if (seed !== undefined) {
    const library = useStore.getState().materialLibrary?.name ?? 'the material library';
    useToastStore
      .getState()
      .pushToast(`Saved ${preset.materialName} — ${preset.description} to ${library}.`, 'success');
  }
}

function ensureActiveLibrary(): void {
  const state = useStore.getState();
  if (state.materialLibrary === null) state.createLibrary(`${state.project.device.name} Library`);
}

function seedState(args: {
  readonly existing: MaterialPreset | null;
  readonly seed: MaterialPresetWizardSeed | undefined;
}): WizardState {
  if (args.existing !== null) {
    return initialWizardState({
      identity: identityFromPreset(args.existing),
      recipe: args.existing.recipe,
    });
  }
  return initialWizardState({
    identity: args.seed?.identity ?? EMPTY_IDENTITY,
    recipe: args.seed?.recipe ?? defaultRecipe(),
  });
}

const headerStyle: React.CSSProperties = { marginBottom: 8 };
