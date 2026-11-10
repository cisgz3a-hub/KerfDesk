// The laser half of the artwork inspector (ADR-430): the process, the three
// numbers everyone sets, the one or two settings that matter for that process,
// and one-line switches. Everything else is one click away in Cut Settings,
// and the "More cut settings" row names what it holds.
import type { LayerMode } from '../../core/scene';
import { captureLayerOperationSettings, type Layer } from '../../core/scene';
import { Icon } from '../kit';
import { useStore } from '../state';
import { LayerRowCutSettings } from './LayerRowCutSettings';
import { LayerImageEssentials } from './LayerImageFields';
import {
  FieldRow,
  HatchAngleInput,
  HatchSpacingInput,
  LaserEssentialsFields,
  ScanDirectionField,
  type LayerOperationControlTarget,
} from './LayerRowFields';
import { hasMixedFields, type MixedOperationFields } from './selected-operation-mixed';
import { mixedCheckboxProps } from './mixed-operation-input';
import { useCutSettingsLauncher } from './use-cut-settings-launcher';
import { LaserProcessField } from './LaserProcessField';
import { StarterValuesNotice, usesStarterValues } from './StarterValuesNotice';
import { SimpleViewSettingsNote } from './SimpleViewSettingsNote';
import { useSimpleView } from '../state/simple-view';
import './laser-operation-settings.css';

export function LaserOperationFields(props: {
  readonly operation: Layer;
  readonly baseOperation: Layer;
  readonly editObjectOverride: boolean;
  readonly objectIds: ReadonlyArray<string>;
  readonly ariaContext: string;
  readonly mixedFields: MixedOperationFields;
  readonly reconcileKey: string;
  // Shown under the Line / Fill / Image switch, so a warning the click causes
  // never pushes the switch away from the pointer.
  readonly processNotice?: React.ReactNode;
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
  const target: LayerOperationControlTarget = {
    settings: captureLayerOperationSettings(props.operation),
    selectedObjectCount: props.editObjectOverride ? props.objectIds.length : 0,
    ariaContext: props.ariaContext,
    mixedFields: props.mixedFields,
    reconcileKey: props.reconcileKey,
    commit,
    owner: props.editObjectOverride
      ? { operationId: props.baseOperation.id, objectIds: props.objectIds }
      : { operationId: props.baseOperation.id },
  };
  const modeMixed = props.mixedFields.mode === true;
  // Simple view (ADR-698) keeps Process, Power, Speed, Passes and every notice;
  // the rest gives way to a note that lists any of it this burn uses.
  const simple = useSimpleView();
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
        mixed={modeMixed}
        ariaLabel={`Mode for ${props.ariaContext}`}
        onChange={(mode) => commit({ mode })}
      />
      {props.processNotice}
      <LaserEssentialsFields layer={props.operation} operationTarget={target} compact />
      {!hasMixedFields(props.mixedFields) && usesStarterValues(props.operation) ? (
        <StarterValuesNotice />
      ) : null}
      {simple ? (
        <SimpleViewSettingsNote settings={target.settings} mixedFields={props.mixedFields} />
      ) : (
        <AdvancedLaserFields
          operation={props.operation}
          target={target}
          airAssistMixed={props.mixedFields.airAssist === true}
          modeMixed={modeMixed}
          cutSettingsBlocked={cutSettingsBlocked}
          onOpenCutSettings={openSettings}
        />
      )}
      {settingsOpen ? (
        <LayerRowCutSettings
          key={props.reconcileKey}
          layer={props.operation}
          onClose={closeSettings}
          // Any count of artworks: a field the operator did not change must
          // keep following the operation (ADR-317 §1, audit 06-P2-2).
          {...(props.editObjectOverride ? { onApply: setOverride, onlyChangedFields: true } : {})}
          {...(props.editObjectOverride && props.objectIds.length > 1
            ? { selectionCount: props.objectIds.length }
            : {})}
        />
      ) : null}
    </div>
  );
}

// What Simple view hides (ADR-698): the process's second-tier settings, the
// one-line switches and the way into Cut Settings.
function AdvancedLaserFields(props: {
  readonly operation: Layer;
  readonly target: LayerOperationControlTarget;
  readonly airAssistMixed: boolean;
  readonly modeMixed: boolean;
  readonly cutSettingsBlocked: boolean;
  readonly onOpenCutSettings: () => void;
}): JSX.Element {
  const { operation, target } = props;
  return (
    <>
      {props.modeMixed ? null : <ProcessEssentials layer={operation} target={target} />}
      <div className="lf-laser-toggles">
        <ScanDirectionField layer={operation} operationTarget={target} />
        <AirAssistField
          checked={operation.airAssist}
          mixed={props.airAssistMixed}
          onChange={(airAssist) => target.commit({ airAssist })}
        />
      </div>
      <MoreCutSettingsButton
        mode={props.modeMixed ? null : operation.mode}
        disabled={props.cutSettingsBlocked}
        onOpen={props.onOpenCutSettings}
      />
    </>
  );
}

// Line has no second-tier essential: contour entry, kerf and the rest are
// profile tuning and live in Cut Settings.
function ProcessEssentials(props: {
  readonly layer: Layer;
  readonly target: LayerOperationControlTarget;
}): JSX.Element | null {
  const { layer, target } = props;
  if (target.settings.mode === 'fill') {
    return (
      <div className="lf-laser-process-fields">
        <FieldRow label="Line spacing" unit="mm">
          <HatchSpacingInput layer={layer} operationTarget={target} />
        </FieldRow>
        <FieldRow label="Angle" unit="°">
          <HatchAngleInput layer={layer} operationTarget={target} />
        </FieldRow>
      </div>
    );
  }
  if (target.settings.mode === 'image') {
    return (
      <LayerImageEssentials
        layer={layer}
        settings={target.settings}
        commit={target.commit}
        reconcileKey={target.reconcileKey}
        labelContext={target.ariaContext ?? layer.name}
        {...(target.mixedFields === undefined ? {} : { mixedFields: target.mixedFields })}
      />
    );
  }
  return null;
}

const MORE_SETTINGS_SUMMARY: Record<LayerMode, string> = {
  line: 'Contour entry, kerf, overcut, tabs, perforation',
  fill: 'Fill style, cross-hatch, overscan',
  image: 'DPI, dot width, invert, overscan, original pixels',
};

function MoreCutSettingsButton(props: {
  readonly mode: LayerMode | null;
  readonly disabled: boolean;
  readonly onOpen: () => void;
}): JSX.Element {
  const summary =
    props.mode === null ? 'Every setting for this operation' : MORE_SETTINGS_SUMMARY[props.mode];
  return (
    <button
      type="button"
      aria-label="More cut settings"
      title={`Open Cut Settings: ${summary}`}
      onClick={props.onOpen}
      disabled={props.disabled}
      className="lf-laser-more"
    >
      <span>
        <strong>More cut settings</strong>
        <small>{summary}</small>
      </span>
      <Icon name="chevron-right" size={16} />
    </button>
  );
}

function AirAssistField(props: {
  readonly checked: boolean;
  readonly mixed: boolean;
  readonly onChange: (airAssist: boolean) => void;
}): JSX.Element {
  const title =
    'Turn job-controlled air assist on for this operation. Machines without air control ignore it.';
  return (
    <label className="lf-laser-toggle" title={title}>
      <input
        type="checkbox"
        {...mixedCheckboxProps(props.checked, props.mixed)}
        aria-label="Air assist for selected operation"
        title={title}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span>Air assist</span>
    </label>
  );
}
