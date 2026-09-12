import { captureLayerOperationSettings, type Layer, type LayerMode } from '../../core/scene';
import { useStore } from '../state';
import { LayerRowCutSettings } from './LayerRowCutSettings';
import { LayerRowSettingsFields } from './LayerRowFields';
import { hasMixedFields, type MixedOperationFields } from './selected-operation-mixed';
import { mixedCheckboxProps } from './mixed-operation-input';
import { useCutSettingsLauncher } from './use-cut-settings-launcher';

export function LaserOperationFields(props: {
  readonly operation: Layer;
  readonly baseOperation: Layer;
  readonly editObjectOverride: boolean;
  readonly objectIds: ReadonlyArray<string>;
  readonly ariaContext: string;
  readonly mixedFields: MixedOperationFields;
  readonly reconcileKey: string;
}): JSX.Element {
  const setLayerParam = useStore((state) => state.setLayerParam);
  const setObjectsOverride = useStore((state) => state.setObjectsOperationOverrideForOperation);
  const setOverride = (patch: Partial<ReturnType<typeof captureLayerOperationSettings>>): void =>
    setObjectsOverride(props.objectIds, props.baseOperation.id, patch);
  const { settingsOpen, cutSettingsBlocked, openSettings, closeSettings } =
    useCutSettingsLauncher();
  const commit = (patch: Partial<ReturnType<typeof captureLayerOperationSettings>>): void => {
    if (props.editObjectOverride) setOverride(patch);
    else setLayerParam(props.baseOperation.id, patch);
  };
  const target = {
    settings: captureLayerOperationSettings(props.operation),
    selectedObjectCount: props.editObjectOverride ? props.objectIds.length : 0,
    ariaContext: props.ariaContext,
    mixedFields: props.mixedFields,
    reconcileKey: props.reconcileKey,
    commit,
  };
  return (
    <>
      {hasMixedFields(props.mixedFields) ? (
        <p style={hintStyle}>
          Mixed settings. Changes apply to all {props.objectIds.length} selected artworks; other
          settings stay independent.
        </p>
      ) : null}
      <ProcessField
        operation={props.operation}
        mixed={props.mixedFields.mode === true}
        ariaContext={props.ariaContext}
        onChange={(mode) => commit({ mode })}
      />
      <LayerRowSettingsFields layer={props.operation} operationTarget={target} />
      <label title="Turn job-controlled air assist on for this operation" style={airAssistStyle}>
        <input
          type="checkbox"
          {...mixedCheckboxProps(props.operation.airAssist, props.mixedFields.airAssist)}
          aria-label="Air assist for selected operation"
          title="Turn job-controlled air assist on for this operation"
          onChange={(event) => commit({ airAssist: event.target.checked })}
        />{' '}
        Air assist
      </label>
      <button
        type="button"
        title="Open advanced laser operation settings"
        onClick={openSettings}
        disabled={cutSettingsBlocked}
      >
        Advanced cut settings
      </button>
      {settingsOpen ? (
        <LayerRowCutSettings
          key={props.reconcileKey}
          layer={props.operation}
          onClose={closeSettings}
          {...(props.editObjectOverride ? { onApply: setOverride } : {})}
          {...(props.editObjectOverride && props.objectIds.length > 1
            ? { selectionCount: props.objectIds.length }
            : {})}
        />
      ) : null}
    </>
  );
}

function ProcessField(props: {
  readonly operation: Layer;
  readonly mixed: boolean;
  readonly ariaContext: string;
  readonly onChange: (mode: LayerMode) => void;
}): JSX.Element {
  return (
    <label style={fieldRowStyle}>
      <span>Process</span>
      <select
        value={props.mixed ? '' : props.operation.mode}
        aria-label={`Mode for ${props.ariaContext}`}
        title="Choose how the laser processes the selected artwork"
        onChange={(event) => props.onChange(event.target.value as LayerMode)}
      >
        {props.mixed ? (
          <option value="" disabled>
            Mixed
          </option>
        ) : null}
        <option value="line">Line</option>
        <option value="fill">Fill</option>
        <option value="image">Image</option>
      </select>
    </label>
  );
}

const hintStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-muted)' };
const airAssistStyle: React.CSSProperties = { fontSize: 12 };
const fieldRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '100px 1fr',
  gap: 8,
  alignItems: 'center',
};
