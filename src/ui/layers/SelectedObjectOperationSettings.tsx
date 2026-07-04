import { useEffect, useRef } from 'react';
import {
  captureLayerOperationSettings,
  sceneObjectPrimaryLayerColor,
  type Layer,
  type LayerFillStyle,
  type LayerMode,
  type LayerOperationSettings,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { LayerImageFields } from './LayerImageFields';
import {
  hasMixedFields,
  mixedOperationFields,
  type MixedOperationFields,
} from './selected-operation-mixed';
import { useDebouncedCommit } from './use-debounced-commit';

const MIXED_SELECT_VALUE = '__mixed__';

export function SelectedObjectOperationSettings(props: {
  readonly objects: ReadonlyArray<SceneObject>;
}): JSX.Element | null {
  const layers = useStore((state) => state.project.scene.layers);
  const setSelectedObjectsOperationOverride = useStore(
    (state) => state.setSelectedObjectsOperationOverride,
  );
  const clearSelectedObjectsOperationOverride = useStore(
    (state) => state.clearSelectedObjectsOperationOverride,
  );
  const maxFeed = useStore((state) => state.project.device.maxFeed);
  const context = commonEffectiveOperationSettings(props.objects, layers);
  if (context === null) return null;
  const hasOverride = props.objects.some((object) => object.operationOverride !== undefined);
  const commit = setSelectedObjectsOperationOverride;
  const reset = clearSelectedObjectsOperationOverride;
  return (
    <SelectedOperationControls
      settings={context.settings}
      layer={context.layer}
      mixed={context.mixed}
      maxFeed={maxFeed}
      hasOverride={hasOverride}
      commit={commit}
      reset={reset}
    />
  );
}

function SelectedOperationControls(props: {
  readonly settings: LayerOperationSettings;
  readonly layer: Layer;
  readonly mixed: MixedOperationFields;
  readonly maxFeed: number;
  readonly hasOverride: boolean;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
  readonly reset: () => void;
}): JSX.Element {
  const { settings, commit } = props;
  const hasMixed = hasMixedFields(props.mixed);
  return (
    <>
      <h3 style={subheadingStyle}>Selected Artwork Settings</h3>
      {hasMixed ? (
        <p aria-label="Selected artwork mixed settings" style={mixedHintStyle}>
          Mixed values in selection. Edit a field to apply one value to all selected artwork.
        </p>
      ) : null}
      <BaseOperationFields
        settings={settings}
        mixed={props.mixed}
        maxFeed={props.maxFeed}
        commit={commit}
      />
      {settings.mode === 'fill' && props.mixed.mode !== true ? (
        <SelectedFillFields settings={settings} mixed={props.mixed} commit={commit} />
      ) : null}
      {settings.mode === 'image' ? (
        <LayerImageFields
          layer={props.layer}
          settings={settings}
          commit={commit}
          labelContext="selected objects"
          minPowerMax={settings.power}
        />
      ) : null}
      <ResetSelectedOperationButton hasOverride={props.hasOverride} reset={props.reset} />
    </>
  );
}

function BaseOperationFields(props: {
  readonly settings: LayerOperationSettings;
  readonly mixed: MixedOperationFields;
  readonly maxFeed: number;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { settings, commit } = props;
  return (
    <>
      <FieldRow label="Mode">
        <select
          value={props.mixed.mode === true ? MIXED_SELECT_VALUE : settings.mode}
          onChange={(event) => commit({ mode: event.target.value as LayerMode })}
          aria-label="Mode for selected objects"
          title="Override operation mode for the selected artwork only."
          style={selectStyle}
        >
          {props.mixed.mode === true ? (
            <option value={MIXED_SELECT_VALUE} disabled>
              Mixed
            </option>
          ) : null}
          <option value="line">Line</option>
          <option value="fill">Fill</option>
          <option value="image">Image</option>
        </select>
      </FieldRow>
      <NumberField
        label="Power"
        value={settings.power}
        mixed={props.mixed.power === true}
        min={0}
        max={100}
        step={1}
        unit="%"
        ariaLabel="Power for selected objects"
        commit={(power) => commit({ power, minPower: Math.min(settings.minPower, power) })}
        parse={(value) => clamp(numericValue(value, settings.power), 0, 100)}
      />
      <NumberField
        label="Speed"
        value={settings.speed}
        mixed={props.mixed.speed === true}
        min={1}
        max={props.maxFeed}
        step={1}
        unit="mm/min"
        ariaLabel="Speed for selected objects"
        commit={(speed) => commit({ speed })}
        parse={(value) => clamp(numericValue(value, settings.speed), 1, props.maxFeed)}
      />
      <NumberField
        label="Passes"
        value={settings.passes}
        mixed={props.mixed.passes === true}
        min={1}
        step={1}
        ariaLabel="Passes for selected objects"
        commit={(passes) => commit({ passes })}
        parse={(value) => Math.max(1, Math.floor(numericValue(value, settings.passes)))}
      />
    </>
  );
}

function ResetSelectedOperationButton(props: {
  readonly hasOverride: boolean;
  readonly reset: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.reset}
      disabled={!props.hasOverride}
      title="Remove selected-artwork overrides so the layer settings apply again."
    >
      Reset to layer defaults
    </button>
  );
}

function SelectedFillFields(props: {
  readonly settings: LayerOperationSettings;
  readonly mixed: MixedOperationFields;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { settings, commit } = props;
  return (
    <>
      <FieldRow label="Style">
        <select
          value={props.mixed.fillStyle === true ? MIXED_SELECT_VALUE : settings.fillStyle}
          onChange={(event) => commit({ fillStyle: parseFillStyle(event.target.value) })}
          aria-label="Fill style for selected objects"
          title="Override fill style for the selected artwork only."
          style={selectStyle}
        >
          {props.mixed.fillStyle === true ? (
            <option value={MIXED_SELECT_VALUE} disabled>
              Mixed
            </option>
          ) : null}
          <option value="scanline">Scanline</option>
          <option value="offset">Follow Shape</option>
          <option value="island">Island Fill</option>
        </select>
      </FieldRow>
      <NumberField
        label="Hatch angle"
        value={settings.hatchAngleDeg}
        mixed={props.mixed.hatchAngleDeg === true}
        min={0}
        max={180}
        step={5}
        unit="deg"
        ariaLabel="Hatch angle for selected objects"
        commit={(hatchAngleDeg) => commit({ hatchAngleDeg })}
        parse={(value) => clamp(numericValue(value, settings.hatchAngleDeg), 0, 180)}
      />
      <NumberField
        label="Hatch spacing"
        value={settings.hatchSpacingMm}
        mixed={props.mixed.hatchSpacingMm === true}
        min={0.05}
        max={10}
        step={0.05}
        unit="mm"
        ariaLabel="Hatch spacing for selected objects"
        commit={(hatchSpacingMm) => commit({ hatchSpacingMm })}
        parse={(value) => clamp(numericValue(value, settings.hatchSpacingMm), 0.05, 10)}
      />
      <NumberField
        label="Overscan"
        value={settings.fillOverscanMm}
        mixed={props.mixed.fillOverscanMm === true}
        min={0}
        max={25}
        step={0.5}
        unit="mm"
        ariaLabel="Fill overscan for selected objects"
        commit={(fillOverscanMm) => commit({ fillOverscanMm })}
        parse={(value) => clamp(numericValue(value, settings.fillOverscanMm), 0, 25)}
      />
      <FieldRow label="Bidirectional">
        <MixedCheckbox
          checked={settings.fillBidirectional}
          mixed={props.mixed.fillBidirectional === true}
          onChange={(checked) => commit({ fillBidirectional: checked })}
          aria-label="Bidirectional fill for selected objects"
          title="Override bidirectional fill for the selected artwork only."
        />
      </FieldRow>
    </>
  );
}

function NumberField(props: {
  readonly label: string;
  readonly value: number;
  readonly mixed?: boolean;
  readonly min: number;
  readonly max?: number;
  readonly step: number;
  readonly unit?: string;
  readonly ariaLabel: string;
  readonly commit: (value: number) => void;
  readonly parse: (value: string) => number;
}): JSX.Element {
  const debounced = useDebouncedCommit<number | null>({
    value: props.mixed === true ? null : props.value,
    commit: (value) => {
      if (value !== null) props.commit(value);
    },
    parse: (value) => (value.trim() === '' ? null : props.parse(value)),
    format: (value) => (value === null ? '' : String(value)),
  });
  return (
    <FieldRow label={props.label}>
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={debounced.displayValue}
        placeholder={props.mixed === true ? 'Mixed' : undefined}
        onChange={debounced.onChange}
        onBlur={debounced.onBlur}
        aria-label={props.ariaLabel}
        title={props.ariaLabel}
        style={inputStyle}
      />
      {props.unit === undefined ? null : <span style={unitStyle}>{props.unit}</span>}
    </FieldRow>
  );
}

function MixedCheckbox(props: {
  readonly checked: boolean;
  readonly mixed: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly 'aria-label': string;
  readonly title: string;
}): JSX.Element {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = props.mixed;
  }, [props.mixed]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={props.mixed ? false : props.checked}
      onChange={(event) => props.onChange(event.target.checked)}
      aria-label={props['aria-label']}
      title={props.title}
    />
  );
}

function FieldRow(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>{props.label}</span>
      <span style={controlStyle}>{props.children}</span>
    </label>
  );
}

type SelectedOperationContext = {
  readonly layer: Layer;
  readonly settings: LayerOperationSettings;
  readonly mixed: MixedOperationFields;
};

type EffectiveOperationContext = {
  readonly layer: Layer;
  readonly settings: LayerOperationSettings;
};

function commonEffectiveOperationSettings(
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer>,
): SelectedOperationContext | null {
  const contexts = objects.map((object) => effectiveOperationSettings(object, layers));
  const first = contexts[0] ?? null;
  if (first === null) return null;
  const mixed = mixedOperationFields(
    first.settings,
    contexts.map((context) => context?.settings),
  );
  return { ...first, mixed };
}

function effectiveOperationSettings(
  object: SceneObject,
  layers: ReadonlyArray<Layer>,
): EffectiveOperationContext | null {
  const color = sceneObjectPrimaryLayerColor(object);
  const layer = color === null ? undefined : layers.find((candidate) => candidate.color === color);
  if (layer === undefined) return null;
  return {
    layer,
    settings: { ...captureLayerOperationSettings(layer), ...(object.operationOverride ?? {}) },
  };
}

function numericValue(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFillStyle(value: string): LayerFillStyle {
  if (value === 'island') return value;
  if (value === 'offset') return value;
  return 'scanline';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const subheadingStyle: React.CSSProperties = { fontSize: 13, margin: '12px 0 8px 0' };
const mixedHintStyle: React.CSSProperties = {
  margin: '0 0 8px 0',
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '92px 1fr',
  alignItems: 'center',
  gap: 8,
  marginBottom: 6,
};
const labelStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const controlStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const selectStyle: React.CSSProperties = { width: '100%', padding: '3px 4px' };
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
  borderRadius: 4,
};
const unitStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text-faint)' };
