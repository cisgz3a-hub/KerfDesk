// Pure step model for the create/edit material preset wizard (ADR-093, F-ML2).
//
// Steps are a discriminated union walked with assertNever so a new step is a
// compile error until every switch handles it. The draft (identity + recipe)
// lives here and is committed to the library only on the final Save by the
// component — Cancel/Escape at any step discards it.

import type { MaterialRecipe } from '../../../core/material-library';
import { assertNever } from '../../../core/scene';

export type WizardStep = 'identity' | 'settings' | 'details' | 'review';

export const WIZARD_STEPS = [
  'identity',
  'settings',
  'details',
  'review',
] as const satisfies readonly WizardStep[];

export type ThicknessMode = 'thickness' | 'surface';

export type IdentityDraft = {
  readonly materialName: string;
  readonly thicknessMode: ThicknessMode;
  readonly thicknessMm: string;
  readonly title: string;
  readonly description: string;
};

export const EMPTY_IDENTITY: IdentityDraft = {
  materialName: '',
  thicknessMode: 'thickness',
  thicknessMm: '',
  title: '',
  description: '',
};

export type WizardState = {
  readonly step: WizardStep;
  readonly identity: IdentityDraft;
  readonly recipe: MaterialRecipe;
};

export type WizardAction =
  | { readonly kind: 'set-identity'; readonly identity: IdentityDraft }
  | { readonly kind: 'set-recipe'; readonly recipe: MaterialRecipe }
  | { readonly kind: 'next' }
  | { readonly kind: 'back' }
  | { readonly kind: 'edit'; readonly step: WizardStep };

export function initialWizardState(seed: {
  readonly identity: IdentityDraft;
  readonly recipe: MaterialRecipe;
}): WizardState {
  return { step: 'identity', identity: seed.identity, recipe: seed.recipe };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.kind) {
    case 'set-identity':
      return { ...state, identity: action.identity };
    case 'set-recipe':
      return { ...state, recipe: action.recipe };
    case 'next':
      return { ...state, step: nextStep(state.step) };
    case 'back':
      return { ...state, step: previousStep(state.step) };
    case 'edit':
      return { ...state, step: action.step };
    default:
      return assertNever(action, 'wizard action');
  }
}

export function nextStep(step: WizardStep): WizardStep {
  switch (step) {
    case 'identity':
      return 'settings';
    case 'settings':
      return 'details';
    case 'details':
      return 'review';
    case 'review':
      return 'review';
    default:
      return assertNever(step, 'wizard step');
  }
}

export function previousStep(step: WizardStep): WizardStep {
  switch (step) {
    case 'identity':
      return 'identity';
    case 'settings':
      return 'identity';
    case 'details':
      return 'settings';
    case 'review':
      return 'details';
    default:
      return assertNever(step, 'wizard step');
  }
}

export function stepNumber(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step) + 1;
}

export function stepHeading(step: WizardStep): string {
  switch (step) {
    case 'identity':
      return 'Material';
    case 'settings':
      return 'Cut settings';
    case 'details':
      return 'Details';
    case 'review':
      return 'Review';
    default:
      return assertNever(step, 'wizard step');
  }
}

// Gates the identity step's Next button: a name, a description, and either a
// positive thickness or a non-empty surface title (never the silent
// "fill one, not both" rule the old form had).
export function identityComplete(identity: IdentityDraft): boolean {
  if (identity.materialName.trim().length === 0) return false;
  if (identity.description.trim().length === 0) return false;
  if (identity.thicknessMode === 'surface') return identity.title.trim().length > 0;
  const mm = Number(identity.thicknessMm);
  return identity.thicknessMm.trim().length > 0 && Number.isFinite(mm) && mm > 0;
}
