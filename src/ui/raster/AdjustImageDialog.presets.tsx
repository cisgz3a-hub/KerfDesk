import * as styles from './AdjustImageDialog.styles';

export type BuiltInImagePresetId = 'custom' | 'basic' | 'black-paint-on-white';

type PresetDraft = {
  readonly presetId: BuiltInImagePresetId;
  readonly brightness: number;
  readonly contrast: number;
  readonly gamma: number;
  readonly negativeImage: boolean;
  readonly invertDisplay: boolean;
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
  readonly value: BuiltInImagePresetId;
  readonly onChange: (value: BuiltInImagePresetId) => void;
}): JSX.Element {
  return (
    <label style={styles.fieldStyle}>
      <span style={styles.labelStyle}>Preset</span>
      <select
        name="imagePreset"
        value={props.value}
        onChange={(event) => props.onChange(parseBuiltInImagePreset(event.target.value))}
        style={styles.inputStyle}
      >
        {BUILT_IN_IMAGE_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function applyBuiltInImagePreset<T extends PresetDraft>(
  draft: T,
  presetId: BuiltInImagePresetId,
): T {
  if (presetId === 'custom') return { ...draft, presetId };
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

export function parseBuiltInImagePreset(value: string): BuiltInImagePresetId {
  return BUILT_IN_IMAGE_PRESETS.some((preset) => preset.id === value)
    ? (value as BuiltInImagePresetId)
    : 'custom';
}
