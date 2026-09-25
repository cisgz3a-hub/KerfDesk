// "New preset from this operation..." (ADR-381). A laser operation opens the
// material preset wizard prefilled with every setting it burns with, the
// artwork's own overrides included; the operator names the material and
// thickness. A CNC operation saves its feeds and speeds as a CNC feeds preset,
// the store CNC presets use, because material presets hold laser settings only.

import { useState } from 'react';
import { DEFAULT_CNC_LAYER_SETTINGS, type CncLayerSettings, type Layer } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';
import { MaterialPresetWizard } from '../material-library/wizard';
import { seedFromOperation } from '../material-library/wizard/wizard-seed';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';

export function NewPresetFromOperation(props: {
  /** The settings the selected artwork burns with. */
  readonly operation: Layer;
  readonly machineKind: 'laser' | 'cnc';
  /** Why the settings cannot be captured (a mixed selection), if they cannot. */
  readonly unavailableReason?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const title =
    props.unavailableReason ??
    (props.machineKind === 'cnc'
      ? 'Save this operation’s feeds and speeds as a CNC feeds preset.'
      : 'Start a material preset with every setting of this operation.');
  return (
    <>
      <button
        type="button"
        className="lf-btn lf-laser-advanced-button"
        title={title}
        disabled={props.unavailableReason !== undefined}
        onClick={() => setOpen(true)}
      >
        New preset from this operation...
      </button>
      {open && props.machineKind === 'laser' ? (
        <MaterialPresetWizard
          seed={seedFromOperation(props.operation)}
          onClose={() => setOpen(false)}
        />
      ) : null}
      {open && props.machineKind === 'cnc' ? (
        <CncPresetFromOperationDialog operation={props.operation} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function CncPresetFromOperationDialog(props: {
  readonly operation: Layer;
  readonly onClose: () => void;
}): JSX.Element {
  const saveCncFeedPreset = useStore((s) => s.saveCncFeedPreset);
  const settings: CncLayerSettings = props.operation.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  const [name, setName] = useState(props.operation.name);
  const trimmed = name.trim();
  return (
    <Dialog
      onClose={props.onClose}
      title="New CNC feeds preset"
      as="form"
      size="sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed === '') return;
        saveCncFeedPreset(trimmed, settings);
        useToastStore.getState().pushToast(`Saved CNC feeds preset ${trimmed}.`, 'success');
        props.onClose();
      }}
    >
      <p className="lf-subheading">Settings copied from {props.operation.name}.</p>
      <dl style={listStyle}>
        <dt>Feed</dt>
        <dd>{settings.feedMmPerMin} mm/min</dd>
        <dt>Plunge</dt>
        <dd>{settings.plungeMmPerMin} mm/min</dd>
        <dt>Spindle</dt>
        <dd>{settings.spindleRpm} rpm</dd>
        <dt>Depth per pass</dt>
        <dd>{settings.depthPerPassMm} mm</dd>
        <dt>Stepover</dt>
        <dd>{settings.stepoverPercent}%</dd>
      </dl>
      <label className="lf-field">
        <span className="lf-field-label">Preset name</span>
        <input
          type="text"
          className="lf-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="CNC feeds preset name"
          title="Name for this feeds and speeds preset."
          required
        />
      </label>
      <DialogActions>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={trimmed === ''}>
          Save preset
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const listStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content 1fr',
  gap: '4px 12px',
  margin: '8px 0 12px',
  fontSize: 12,
};
