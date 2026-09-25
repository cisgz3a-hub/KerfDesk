// The rail's entry point to the create/edit wizard: New material... always,
// and Edit... / Duplicate... for the currently selected preset. Owns the
// open/editing state so the Cuts/Layers panel stays small.

import { useState } from 'react';
import type { MaterialPreset } from '../../../io/material-library';
import { Button } from '../../kit';
import { MaterialPresetWizard } from './MaterialPresetWizard';
import { seedFromPreset } from './wizard-seed';

type WizardRequest =
  | { readonly kind: 'new' }
  | { readonly kind: 'edit'; readonly preset: MaterialPreset }
  | { readonly kind: 'duplicate'; readonly preset: MaterialPreset };

export function MaterialPresetWizardLauncher(props: {
  readonly selectedPreset: MaterialPreset | null;
  readonly onSaved: (id: string) => void;
}): JSX.Element {
  const [request, setRequest] = useState<WizardRequest | null>(null);
  const selected = props.selectedPreset;
  return (
    <>
      <div style={rowStyle}>
        <Button
          aria-label="New material preset"
          title="Create a new material preset step by step."
          onClick={() => setRequest({ kind: 'new' })}
        >
          New material...
        </Button>
        <Button
          aria-label="Edit selected material preset"
          title="Edit the selected material preset step by step."
          disabled={selected === null}
          onClick={() => {
            if (selected !== null) setRequest({ kind: 'edit', preset: selected });
          }}
        >
          Edit...
        </Button>
        <Button
          aria-label="Duplicate selected material preset"
          title="Start a new preset from a copy of the selected one, for a similar material or thickness."
          disabled={selected === null}
          onClick={() => {
            if (selected !== null) setRequest({ kind: 'duplicate', preset: selected });
          }}
        >
          Duplicate...
        </Button>
      </div>
      {request === null ? null : (
        <MaterialPresetWizard
          existingPreset={request.kind === 'edit' ? request.preset : null}
          {...(request.kind === 'duplicate' ? { seed: seedFromPreset(request.preset) } : {})}
          onClose={() => setRequest(null)}
          onSaved={props.onSaved}
        />
      )}
    </>
  );
}

const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
