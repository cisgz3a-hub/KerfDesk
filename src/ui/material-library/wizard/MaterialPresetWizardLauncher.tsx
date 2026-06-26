// The rail's entry point to the create/edit wizard: New material... always, and
// Edit... for the currently selected preset. Owns the open/editing state so the
// Cuts/Layers panel stays small.

import { useState } from 'react';
import type { MaterialPreset } from '../../../io/material-library';
import { Button } from '../../kit';
import { MaterialPresetWizard } from './MaterialPresetWizard';

export function MaterialPresetWizardLauncher(props: {
  readonly selectedPreset: MaterialPreset | null;
  readonly onSaved: (id: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MaterialPreset | null>(null);
  return (
    <>
      <div style={rowStyle}>
        <Button
          aria-label="New material preset"
          title="Create a new material preset step by step."
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          New material...
        </Button>
        <Button
          aria-label="Edit selected material preset"
          title="Edit the selected material preset step by step."
          disabled={props.selectedPreset === null}
          onClick={() => {
            setEditing(props.selectedPreset);
            setOpen(true);
          }}
        >
          Edit...
        </Button>
      </div>
      {open ? (
        <MaterialPresetWizard
          existingPreset={editing}
          onClose={() => setOpen(false)}
          onSaved={props.onSaved}
        />
      ) : null}
    </>
  );
}

const rowStyle: React.CSSProperties = { display: 'flex', gap: 8 };
