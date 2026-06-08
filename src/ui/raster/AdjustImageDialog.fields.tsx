import { MAX_RASTER_LINES_PER_MM } from '../../core/raster/raster-budget';
import { DITHER_ALGORITHMS, type Layer } from '../../core/scene';
import {
  algorithmLabel,
  dotWidthCorrectionMax,
  numberValue,
  parseDither,
} from './AdjustImageDialog.form-utils';
import { type ImagePresetId, PresetField } from './AdjustImageDialog.presets';
import * as styles from './AdjustImageDialog.styles';
import type { AdjustImageDraft } from './AdjustImageDialog.types';
import type { UserImagePreset } from './AdjustImageDialog.user-presets';

export function AdjustFields(props: {
  readonly draft: AdjustImageDraft;
  readonly maxPower: number;
  readonly update: (patch: Partial<AdjustImageDraft>) => void;
  readonly applyPreset: (presetId: ImagePresetId) => void;
  readonly userPresets: readonly UserImagePreset[];
  readonly savePreset: () => void;
  readonly deletePreset: () => void;
}): JSX.Element {
  const { draft, update, applyPreset, userPresets, savePreset, deletePreset } = props;
  return (
    <div style={styles.fieldsGridStyle}>
      <PresetField
        value={draft.presetId}
        userPresets={userPresets}
        onChange={applyPreset}
        onSave={savePreset}
        onDelete={deletePreset}
      />
      <NumberField
        name="brightness"
        label="Brightness"
        value={draft.brightness}
        min={-100}
        max={100}
        step={1}
        onChange={(brightness) => update({ brightness })}
      />
      <NumberField
        name="contrast"
        label="Contrast"
        value={draft.contrast}
        min={-100}
        max={100}
        step={1}
        onChange={(contrast) => update({ contrast })}
      />
      <NumberField
        name="gamma"
        label="Gamma"
        value={draft.gamma}
        min={0.1}
        max={5}
        step={0.05}
        onChange={(gamma) => update({ gamma })}
      />
      <RasterSettingsFields draft={draft} maxPower={props.maxPower} update={update} />
      <RasterToggleFields draft={draft} update={update} />
    </div>
  );
}

function RasterSettingsFields(props: {
  readonly draft: AdjustImageDraft;
  readonly maxPower: number;
  readonly update: (patch: Partial<AdjustImageDraft>) => void;
}): JSX.Element {
  const { draft, update } = props;
  return (
    <>
      <SelectField
        value={draft.ditherAlgorithm}
        onChange={(ditherAlgorithm) => update({ ditherAlgorithm })}
      />
      <NumberField
        name="minPower"
        label="Min Power"
        value={draft.minPower}
        min={0}
        max={props.maxPower}
        step={1}
        unit="%"
        onChange={(minPower) => update({ minPower })}
      />
      <NumberField
        name="linesPerMm"
        label="Resolution"
        value={draft.linesPerMm}
        min={5}
        max={MAX_RASTER_LINES_PER_MM}
        step={1}
        unit="lines / mm"
        onChange={(linesPerMm) => update({ linesPerMm })}
      />
      <NumberField
        name="dotWidthCorrectionMm"
        label="Dot Width"
        value={draft.dotWidthCorrectionMm}
        min={0}
        max={dotWidthCorrectionMax(draft.linesPerMm)}
        step={0.001}
        unit="mm"
        onChange={(dotWidthCorrectionMm) => update({ dotWidthCorrectionMm })}
      />
    </>
  );
}

function RasterToggleFields(props: {
  readonly draft: AdjustImageDraft;
  readonly update: (patch: Partial<AdjustImageDraft>) => void;
}): JSX.Element {
  const { draft, update } = props;
  return (
    <>
      <CheckboxField
        name="negativeImage"
        label="Negative Image"
        checked={draft.negativeImage}
        onChange={(negativeImage) => update({ negativeImage })}
      />
      <CheckboxField
        name="passThrough"
        label="Pass-through"
        checked={draft.passThrough}
        onChange={(passThrough) => update({ passThrough })}
      />
      <CheckboxField
        name="invertDisplay"
        label="Invert Preview"
        checked={draft.invertDisplay}
        onChange={(invertDisplay) => update({ invertDisplay })}
      />
    </>
  );
}

function NumberField(props: {
  readonly name: string;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label style={styles.fieldStyle}>
      <span style={styles.labelStyle}>{props.label}</span>
      <input
        name={props.name}
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(numberValue(event.target.value, props.min, props.max))}
        style={styles.inputStyle}
      />
      {props.unit === undefined ? null : <span style={styles.unitStyle}>{props.unit}</span>}
    </label>
  );
}

function SelectField(props: {
  readonly value: Layer['ditherAlgorithm'];
  readonly onChange: (value: Layer['ditherAlgorithm']) => void;
}): JSX.Element {
  return (
    <label style={styles.fieldStyle}>
      <span style={styles.labelStyle}>Dither</span>
      <select
        name="ditherAlgorithm"
        value={props.value}
        onChange={(event) => props.onChange(parseDither(event.target.value))}
        style={styles.inputStyle}
      >
        {DITHER_ALGORITHMS.map((algorithm) => (
          <option key={algorithm} value={algorithm}>
            {algorithmLabel(algorithm)}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckboxField(props: {
  readonly name: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label style={styles.checkboxStyle}>
      <span style={styles.labelStyle}>{props.label}</span>
      <input
        name={props.name}
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
    </label>
  );
}
