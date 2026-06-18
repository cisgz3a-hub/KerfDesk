import { useState } from 'react';
import { Button } from '../kit';
import { useStore } from '../state';
import type { CreateMaterialPresetInput } from '../state/material-library-actions';
import { formStyle, splitRowStyle } from './material-library-panel-styles';

type CreateDraft = {
  readonly materialName: string;
  readonly thicknessMm: string;
  readonly title: string;
  readonly description: string;
};

const EMPTY_DRAFT: CreateDraft = { materialName: '', thicknessMm: '', title: '', description: '' };

export function CreatePresetForm(props: {
  readonly targetLayerId: string;
  readonly entryCount: number;
  readonly isCalibrated: boolean;
  readonly onCreated: (id: string) => void;
  readonly onFailed: (message: string) => void;
}): JSX.Element {
  const createMaterialPresetFromLayer = useStore((state) => state.createMaterialPresetFromLayer);
  const [draft, setDraft] = useState<CreateDraft>(EMPTY_DRAFT);
  const createInput = createPresetInput(draft, props.entryCount);
  const createDisabled = props.targetLayerId === '' || createInput === null;
  const actionLabel = props.isCalibrated
    ? 'Create calibrated recipe'
    : 'Create preset from selected layer';
  return (
    <form
      style={formStyle}
      onSubmit={(event) => {
        event.preventDefault();
        if (createInput === null) {
          props.onFailed('Enter a material name, description, and thickness or title.');
          return;
        }
        const created = createMaterialPresetFromLayer(props.targetLayerId, createInput);
        if (created === null) {
          props.onFailed('Preset was not created.');
          return;
        }
        props.onCreated(created.id);
      }}
    >
      <input
        aria-label="Material name"
        placeholder="Material"
        value={draft.materialName}
        title="Material name for the new library preset."
        onChange={(event) => setDraftValue(setDraft, 'materialName', event.currentTarget.value)}
      />
      <div style={splitRowStyle}>
        <input
          aria-label="Material thickness millimeters"
          placeholder="Thickness mm"
          value={draft.thicknessMm}
          title="Material thickness in millimeters. Use this or a title, not both."
          onChange={(event) => setDraftValue(setDraft, 'thicknessMm', event.currentTarget.value)}
        />
        <input
          aria-label="No thickness title"
          placeholder="Title"
          value={draft.title}
          title="Preset title when thickness is not used. Use this or thickness, not both."
          onChange={(event) => setDraftValue(setDraft, 'title', event.currentTarget.value)}
        />
      </div>
      <input
        aria-label="Preset description"
        placeholder="Description"
        value={draft.description}
        title="Short description of what this preset is for."
        onChange={(event) => setDraftValue(setDraft, 'description', event.currentTarget.value)}
      />
      <Button
        type="submit"
        aria-label={actionLabel}
        title={
          props.isCalibrated
            ? 'Create a calibrated material recipe from the selected test swatch.'
            : 'Create a new material preset from the selected layer settings.'
        }
        disabled={createDisabled}
      >
        {props.isCalibrated ? 'Create Calibrated Recipe' : 'Create from Layer'}
      </Button>
    </form>
  );
}

function setDraftValue(
  setDraft: React.Dispatch<React.SetStateAction<CreateDraft>>,
  key: keyof CreateDraft,
  value: string,
): void {
  setDraft((current) => ({ ...current, [key]: value }));
}

function createPresetInput(
  draft: CreateDraft,
  existingCount: number,
): CreateMaterialPresetInput | null {
  const materialName = draft.materialName.trim();
  const description = draft.description.trim();
  const title = draft.title.trim();
  const thicknessText = draft.thicknessMm.trim();
  const hasTitle = title.length > 0;
  const hasThickness = thicknessText.length > 0;

  if (materialName.length === 0 || description.length === 0) return null;
  if (hasTitle === hasThickness) return null;

  if (hasThickness) {
    const thicknessMm = Number(thicknessText);
    if (!Number.isFinite(thicknessMm) || thicknessMm <= 0) return null;
    return {
      id: presetIdFor(
        materialName,
        `${formatThickness(thicknessMm)}mm`,
        description,
        existingCount,
      ),
      materialName,
      thicknessMm,
      description,
      revision: `manual-${existingCount + 1}`,
    };
  }

  return {
    id: presetIdFor(materialName, title, description, existingCount),
    materialName,
    title,
    description,
    revision: `manual-${existingCount + 1}`,
  };
}

function presetIdFor(
  materialName: string,
  label: string,
  description: string,
  existingCount: number,
): string {
  const suffix = existingCount + 1;
  return `${slug(materialName)}-${slug(label)}-${slug(description).slice(0, 24)}-${suffix}`;
}

function formatThickness(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function slug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'library'
  );
}
