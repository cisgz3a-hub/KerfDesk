// Step 4 — review & save. Summarizes the draft, ranks it against the active
// device profile for a plain compatibility line, and shows the non-negotiable
// "test on scrap" reminder (CLAUDE.md: presets are records, not guarantees).

import type { DeviceProfile } from '../../../core/devices';
import { rankMaterialRecipeCandidates, type MaterialRecipe } from '../../../core/material-library';
import type { MaterialPreset } from '../../../io/material-library';
import { buildPreset } from './wizard-recipe';
import type { IdentityDraft } from './wizard-state';

export function WizardReviewStep(props: {
  readonly identity: IdentityDraft;
  readonly recipe: MaterialRecipe;
  readonly device: DeviceProfile;
  readonly existing: MaterialPreset | null;
}): JSX.Element {
  const preview = buildPreset({
    identity: props.identity,
    recipe: props.recipe,
    existing: props.existing,
    id: 'preview',
    revision: 'preview',
  });
  const [match] = rankMaterialRecipeCandidates(props.device, [preview]);
  const isCompatible = match !== undefined && match.confidence !== 'unsupported';
  return (
    <div style={stepStyle}>
      <dl style={listStyle}>
        <Row label="Material" value={preview.materialName} />
        <Row
          label={preview.thicknessMm !== undefined ? 'Thickness' : 'Title'}
          value={labelValue(preview)}
        />
        <Row label="Description" value={preview.description} />
        <Row label="Mode" value={modeLabel(props.recipe.mode)} />
        <Row label="Power" value={`${props.recipe.power}%`} />
        <Row label="Speed" value={`${props.recipe.speed} mm/min`} />
        <Row label="Passes" value={String(props.recipe.passes)} />
      </dl>
      <p style={compatStyle}>
        {isCompatible
          ? `Compatible with ${props.device.name}.`
          : `May not suit ${props.device.name} — review before cutting.`}
      </p>
      <p style={safetyStyle}>
        These are starting points, not guaranteed settings — always test on scrap before cutting
        final work.
      </p>
    </div>
  );
}

function Row(props: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <>
      <dt style={dtStyle}>{props.label}</dt>
      <dd style={ddStyle}>{props.value}</dd>
    </>
  );
}

function labelValue(preset: MaterialPreset): string {
  if (preset.thicknessMm !== undefined) return `${preset.thicknessMm} mm`;
  return preset.title ?? '';
}

function modeLabel(mode: MaterialRecipe['mode']): string {
  if (mode === 'fill') return 'Fill';
  if (mode === 'image') return 'Image';
  return 'Line';
}

const stepStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };
const listStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: '4px 12px',
  margin: 0,
};
const dtStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const ddStyle: React.CSSProperties = { margin: 0 };
const compatStyle: React.CSSProperties = { margin: 0, fontWeight: 600 };
const safetyStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-muted)' };
