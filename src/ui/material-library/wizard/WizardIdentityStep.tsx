// Step 1 — identity. Controlled inputs (the draft lives in the wizard reducer)
// so Back/Next preserve what was typed. A Thickness/Surface radio reveals the
// matching field, replacing the old form's silent "fill one, not both" rule.

import { Field } from '../../kit';
import type { IdentityDraft } from './wizard-state';

type IdentityStepProps = {
  readonly identity: IdentityDraft;
  readonly onChange: (identity: IdentityDraft) => void;
};

export function WizardIdentityStep(props: IdentityStepProps): JSX.Element {
  const { identity, onChange } = props;
  return (
    <div style={stepStyle}>
      <Field label="Material">
        <input
          className="lf-input"
          type="text"
          value={identity.materialName}
          aria-label="Material name"
          title="Material name for this preset, e.g. Birch plywood."
          placeholder="e.g. Birch plywood"
          onChange={(event) => onChange({ ...identity, materialName: event.currentTarget.value })}
          autoFocus
        />
      </Field>
      <Field label="Type">
        <TypeRadios identity={identity} onChange={onChange} />
      </Field>
      <ThicknessOrTitleField identity={identity} onChange={onChange} />
      <Field label="Description">
        <input
          className="lf-input"
          type="text"
          value={identity.description}
          aria-label="Preset description"
          title="Short description of what this preset is for."
          placeholder="What is this preset for?"
          onChange={(event) => onChange({ ...identity, description: event.currentTarget.value })}
        />
      </Field>
    </div>
  );
}

function TypeRadios(props: IdentityStepProps): JSX.Element {
  const { identity, onChange } = props;
  return (
    <span style={radioRowStyle}>
      <label style={radioStyle}>
        <input
          type="radio"
          name="thicknessMode"
          checked={identity.thicknessMode === 'thickness'}
          aria-label="Has thickness"
          title="Group this preset by material thickness."
          onChange={() => onChange({ ...identity, thicknessMode: 'thickness' })}
        />
        Thickness
      </label>
      <label style={radioStyle}>
        <input
          type="radio"
          name="thicknessMode"
          checked={identity.thicknessMode === 'surface'}
          aria-label="Surface, no thickness"
          title="Group this preset as a surface operation with no thickness."
          onChange={() => onChange({ ...identity, thicknessMode: 'surface' })}
        />
        Surface
      </label>
    </span>
  );
}

function ThicknessOrTitleField(props: IdentityStepProps): JSX.Element {
  const { identity, onChange } = props;
  if (identity.thicknessMode === 'surface') {
    return (
      <Field label="Title">
        <input
          className="lf-input"
          type="text"
          value={identity.title}
          aria-label="Surface title"
          title="Name for this surface preset, e.g. Score."
          placeholder="e.g. Score"
          onChange={(event) => onChange({ ...identity, title: event.currentTarget.value })}
        />
      </Field>
    );
  }
  return (
    <Field label="Thickness" unit="mm">
      <input
        className="lf-input"
        type="number"
        min={0}
        step={0.1}
        value={identity.thicknessMm}
        aria-label="Material thickness millimeters"
        title="Material thickness in millimeters."
        placeholder="3"
        onChange={(event) => onChange({ ...identity, thicknessMm: event.currentTarget.value })}
      />
    </Field>
  );
}

const stepStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const radioRowStyle: React.CSSProperties = { display: 'flex', gap: 16, flex: 1 };
const radioStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
