import { captureLayerOperationSettings, type Layer } from '../../core/scene';
import { useStore } from '../state';
import { LayerRowCutSettings } from './LayerRowCutSettings';
import { LayerRowSettingsFields } from './LayerRowFields';
import { hasMixedFields, type MixedOperationFields } from './selected-operation-mixed';
import { mixedCheckboxProps } from './mixed-operation-input';
import { useCutSettingsLauncher } from './use-cut-settings-launcher';
import { LaserProcessField } from './LaserProcessField';
import './laser-operation-settings.css';

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
    <div className="lf-laser-operation-fields">
      {hasMixedFields(props.mixedFields) ? (
        <p className="lf-laser-help lf-laser-notice">
          Mixed settings. Changes apply to all {props.objectIds.length} selected artworks; other
          settings stay independent.
        </p>
      ) : null}
      <LaserProcessField
        compact
        mode={props.operation.mode}
        mixed={props.mixedFields.mode === true}
        ariaLabel={`Mode for ${props.ariaContext}`}
        onChange={(mode) => commit({ mode })}
      >
        <LayerRowSettingsFields layer={props.operation} operationTarget={target} compact />
      </LaserProcessField>
      <AirAssistField
        checked={props.operation.airAssist}
        mixed={props.mixedFields.airAssist === true}
        onChange={(airAssist) => commit({ airAssist })}
      />
      <button
        type="button"
        title="Open advanced laser operation settings"
        onClick={openSettings}
        disabled={cutSettingsBlocked}
        className="lf-btn lf-laser-advanced-button"
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
    </div>
  );
}

function AirAssistField(props: {
  readonly checked: boolean;
  readonly mixed: boolean;
  readonly onChange: (airAssist: boolean) => void;
}): JSX.Element {
  return (
    <label
      className="lf-laser-air-assist"
      title="Turn job-controlled air assist on for this operation"
    >
      <input
        type="checkbox"
        {...mixedCheckboxProps(props.checked, props.mixed)}
        aria-label="Air assist for selected operation"
        title="Turn job-controlled air assist on for this operation"
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span>
        <strong>Air assist</strong>
        <span className="lf-laser-help">
          Request airflow during this operation on supported machines.
        </span>
      </span>
    </label>
  );
}
