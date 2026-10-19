// What the chosen machine brings with it (ADR-637), under the machine list:
// its size and type, the profile's evidence and notes, and for a CNC preset
// the geometry-only, controller-unchanged disclosure and its sources. A
// Laser + CNC machine also asks which toolhead is fitted.

import { selectControllerDriver } from '../../../core/controllers';
import { profileConfidenceLabel } from '../../../core/devices';
import type { CncMachinePreset } from '../../../core/cnc';
import { DeviceSetupToolheadChoice } from './DeviceSetupMachineCapability';
import type { DeviceSetupStepProps } from './device-setup-flow';
import { machineKindLabel, type MachinePickerEntry } from './machine-picker-entries';

export function DeviceSetupMachineDetails(
  props: DeviceSetupStepProps & { readonly entry: MachinePickerEntry },
): JSX.Element {
  const { entry, state } = props;
  const controller = selectControllerDriver(
    state.draft.controllerKind,
    state.draft.controllerCommandSet,
  ).label;
  return (
    <section className="lf-setup-picker-details" aria-label="Chosen machine">
      <strong>{entry.name}</strong>
      <span className="lf-setup-picker-details-facts">
        {machineFacts(entry).join(' · ')} · {controller}
      </span>
      {entry.kind === 'laser-profile' ? (
        <LaserProfileNotes entry={entry} />
      ) : (
        <CncPresetNotes preset={entry.preset} controllerLabel={controller} />
      )}
      {state.machineKinds.length === 2 ? (
        <DeviceSetupToolheadChoice state={state} dispatch={props.dispatch} />
      ) : null}
    </section>
  );
}

export function machineFacts(entry: MachinePickerEntry): ReadonlyArray<string> {
  return [
    `${entry.bedWidth} × ${entry.bedHeight} mm`,
    ...(entry.kind === 'laser-profile' && entry.opticalPowerW !== undefined
      ? [`${entry.opticalPowerW} W`]
      : []),
    machineKindLabel(entry.machineKinds),
  ];
}

function LaserProfileNotes({
  entry,
}: {
  readonly entry: Extract<MachinePickerEntry, { kind: 'laser-profile' }>;
}): JSX.Element {
  const { suggestion } = entry;
  const reasons = suggestion.confidence === 'manual-only' ? [] : suggestion.reasons;
  return (
    <>
      <span className="lf-setup-profile-badges">
        <span>{profileConfidenceLabel(suggestion.profile)}</span>
      </span>
      {suggestion.warnings.map((warning) => (
        <span key={warning} className="lf-setup-profile-warning">
          {warning}
        </span>
      ))}
      <details className="lf-setup-profile-notes">
        <summary title={`Read profile notes for ${entry.name}`}>Profile details</summary>
        <ul>
          {[...reasons, ...suggestion.entry.reviewNotes].map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </details>
    </>
  );
}

function CncPresetNotes({
  preset,
  controllerLabel,
}: {
  readonly preset: CncMachinePreset;
  readonly controllerLabel: string;
}): JSX.Element {
  return (
    <div className="lf-setup-picker-cnc-notes">
      <p>
        Geometry and spindle ceiling only: {preset.spindleMaxRpm} RPM. {preset.note}
      </p>
      <p role={preset.controllerSupport === 'unqualified' ? 'alert' : 'note'}>
        {preset.controllerNote} Choosing this preset leaves the selected controller unchanged:{' '}
        {controllerLabel}.
      </p>
      <p>
        Sources checked {preset.researchedAt}:{' '}
        {preset.sources.map((source, index) => (
          <span key={source.url}>
            {index > 0 ? '; ' : ''}
            <a href={source.url} target="_blank" rel="noreferrer" title={source.supports}>
              {source.label}
            </a>
          </span>
        ))}
      </p>
    </div>
  );
}
