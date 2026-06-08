import * as styles from './AdjustImageDialog.styles';
import {
  findUserImagePreset,
  type ImagePresetSettings,
  type UserImagePreset,
  userImagePresetId,
} from './AdjustImageDialog.user-presets';

export type BuiltInImagePresetId = 'custom' | 'basic' | 'black-paint-on-white';
export type ImagePresetId = BuiltInImagePresetId | `user:${string}`;

type PresetDraft = ImagePresetSettings & {
  readonly presetId: ImagePresetId;
};

const BUILT_IN_IMAGE_PRESETS = [
  { id: 'custom', label: 'Custom' },
  { id: 'basic', label: 'Basic' },
  { id: 'black-paint-on-white', label: 'Black Paint on White' },
] as const satisfies readonly {
  readonly id: BuiltInImagePresetId;
  readonly label: string;
}[];

export function PresetField(props: {
  readonly value: ImagePresetId;
  readonly userPresets: readonly UserImagePreset[];
  readonly onChange: (value: ImagePresetId) => void;
  readonly onSave: () => void;
  readonly onDelete: () => void;
}): JSX.Element {
  const canDelete = findUserImagePreset(props.userPresets, props.value) !== null;
  return (
    <label style={styles.fieldStyle}>
      <span style={styles.labelStyle}>Preset</span>
      <select
        name="imagePreset"
        value={props.value}
        onChange={(event) => props.onChange(parseImagePresetId(event.target.value))}
        style={styles.inputStyle}
      >
        {BUILT_IN_IMAGE_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
        {props.userPresets.map((preset) => (
          <option key={preset.name} value={userImagePresetId(preset.name)}>
            {preset.name}
          </option>
        ))}
      </select>
      <span style={styles.presetActionsStyle}>
        <button name="saveImagePreset" type="button" onClick={props.onSave}>
          Save
        </button>
        <button
          name="deleteImagePreset"
          type="button"
          disabled={!canDelete}
          onClick={props.onDelete}
        >
          Delete
        </button>
      </span>
    </label>
  );
}

export function applyBuiltInImagePreset<T extends PresetDraft>(
  draft: T,
  presetId: ImagePresetId,
): T {
  if (presetId === 'custom') return { ...draft, presetId };
  if (presetId.startsWith('user:')) return { ...draft, presetId };
  const base = {
    ...draft,
    presetId,
    brightness: 0,
    contrast: 0,
    gamma: 1,
    negativeImage: false,
    invertDisplay: false,
  };
  if (presetId === 'black-paint-on-white') {
    return { ...base, negativeImage: true, invertDisplay: true };
  }
  return base;
}

export function applyUserImagePreset<T extends PresetDraft>(draft: T, preset: UserImagePreset): T {
  return { ...draft, presetId: userImagePresetId(preset.name), ...preset.settings };
}

export function imagePresetSettingsFromDraft(draft: PresetDraft): ImagePresetSettings {
  return {
    brightness: draft.brightness,
    contrast: draft.contrast,
    gamma: draft.gamma,
    ditherAlgorithm: draft.ditherAlgorithm,
    minPower: draft.minPower,
    linesPerMm: draft.linesPerMm,
    dotWidthCorrectionMm: draft.dotWidthCorrectionMm,
    negativeImage: draft.negativeImage,
    passThrough: draft.passThrough,
    invertDisplay: draft.invertDisplay,
  };
}

export function parseImagePresetId(value: string): ImagePresetId {
  return BUILT_IN_IMAGE_PRESETS.some((preset) => preset.id === value) || value.startsWith('user:')
    ? (value as ImagePresetId)
    : 'custom';
}
