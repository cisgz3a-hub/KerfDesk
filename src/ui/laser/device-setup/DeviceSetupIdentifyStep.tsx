// Step 1: choose what the machine is and how KerfDesk must communicate with
// it. Connection deliberately comes second so the first serial open uses the
// reviewed driver and baud rate.

import {
  GRBL_GCODE_DIALECTS,
  MARLIN_GCODE_DIALECTS,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  profileConfidenceLabel,
  suggestMachineProfiles,
  type ControllerKind,
  type DeviceProfile,
  type MachineProfileSuggestion,
} from '../../../core/devices';
import { selectControllerDriver } from '../../../core/controllers';
import {
  fillRunwayPolicyForDevice,
  shouldAdvise4040FillPolicySelection,
} from '../../../core/job/fill-runway-policy';
import { Button } from '../../kit';
import {
  badgeStyle,
  buttonRowStyle,
  cardHeaderStyle,
  cardStyle,
  catalogGridStyle,
  mutedStyle,
  notesStyle,
} from '../MachineSetupStyles';
import { Row } from '../device-settings-shared';
import { ImportExportPanel } from '../MachineSetupImportExport';
import {
  deviceSetupSupportsMachineKind,
  machineSetupProfile,
  type DeviceSetupStepProps,
} from './device-setup-flow';
import { DeviceSetupCncPreset } from './DeviceSetupCncPreset';
import { DeviceSetupMachineCapability } from './DeviceSetupMachineCapability';
import {
  machineSetupControllerGuide,
  machineSetupControllerGuides,
} from './machine-setup-controller-guide';

export function DeviceSetupIdentifyStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const controllerKind = state.draft.controllerKind ?? 'grbl-v1.1';
  const guide = machineSetupControllerGuide(controllerKind);
  const driver = selectControllerDriver(controllerKind);
  const update = (patch: Partial<DeviceProfile>): void => dispatch({ kind: 'edit', patch });
  return (
    <section style={sectionStyle}>
      <SetupIntroduction />
      <DeviceSetupMachineCapability state={state} dispatch={dispatch} />
      <DeviceSetupCncPreset state={state} dispatch={dispatch} />
      <ControllerContract
        state={state}
        controllerKind={controllerKind}
        dispatch={dispatch}
        update={update}
      />
      {deviceSetupSupportsMachineKind(state, 'cnc') && !driver.capabilities.cncJobs ? (
        <p role="alert" style={warningStyle}>
          {guide.label} is not a KerfDesk CNC streaming target. Choose GRBL, grblHAL, or FluidNC
          before continuing with a CNC machine.
        </p>
      ) : null}
      {driver.capabilities.transport === 'serial' ? (
        <AdvancedConnection state={state} controllerKind={controllerKind} update={update} />
      ) : null}
      {deviceSetupSupportsMachineKind(state, 'laser') ? (
        <ProfileCatalog state={state} dispatch={dispatch} />
      ) : null}
      <ProfileImport state={state} dispatch={dispatch} />
    </section>
  );
}

function SetupIntroduction(): JSX.Element {
  return (
    <div style={introStyle}>
      <strong>Start here before connecting.</strong>
      <span>
        Choose every toolhead this physical machine supports, then choose the one KerfDesk should
        make active after Save. The active mode alone controls commands, output, and safety gates.
      </span>
    </div>
  );
}

function ControllerContract(props: {
  readonly state: DeviceSetupStepProps['state'];
  readonly controllerKind: ControllerKind;
  readonly dispatch: DeviceSetupStepProps['dispatch'];
  readonly update: (patch: Partial<DeviceProfile>) => void;
}): JSX.Element {
  const guide = machineSetupControllerGuide(props.controllerKind);
  const driver = selectControllerDriver(props.controllerKind);
  const dialects = props.controllerKind === 'marlin' ? MARLIN_GCODE_DIALECTS : GRBL_GCODE_DIALECTS;
  return (
    <div style={settingsStyle}>
      <Row label="Controller">
        <select
          aria-label="Controller firmware"
          title="Choose the controller firmware family before opening the serial connection."
          value={props.controllerKind}
          onChange={(event) =>
            props.dispatch({
              kind: 'select-controller',
              controllerKind: event.target.value as ControllerKind,
            })
          }
        >
          {machineSetupControllerGuides().map((item) => (
            <option key={item.kind} value={item.kind}>
              {item.label}
            </option>
          ))}
        </select>
        <span style={mutedInlineStyle}>{guide.transportLabel}</span>
      </Row>
      {driver.capabilities.transport === 'serial' ? (
        <BaudRow state={props.state} guide={guide} update={props.update} />
      ) : null}
      {driver.capabilities.transport === 'serial' ? (
        <Row label="Output dialect">
          <select
            aria-label="G-code output dialect"
            title="Choose the output syntax expected by the selected controller firmware."
            value={props.state.draft.gcodeDialect.dialectId}
            onChange={(event) =>
              props.update({
                gcodeDialect: {
                  dialectId: event.target.value as DeviceProfile['gcodeDialect']['dialectId'],
                },
              })
            }
          >
            {dialects.map((dialect) => (
              <option key={dialect.id} value={dialect.id}>
                {dialect.label}
              </option>
            ))}
          </select>
        </Row>
      ) : null}
    </div>
  );
}

function BaudRow(props: {
  readonly state: DeviceSetupStepProps['state'];
  readonly guide: ReturnType<typeof machineSetupControllerGuide>;
  readonly update: (patch: Partial<DeviceProfile>) => void;
}): JSX.Element {
  return (
    <Row label="Baud rate">
      <input
        type="number"
        min={1200}
        max={1000000}
        step={100}
        value={props.state.draft.baudRate ?? props.guide.defaultBaudRate}
        onChange={(event) => {
          const baudRate = Number(event.target.value);
          if (Number.isFinite(baudRate) && baudRate > 0) props.update({ baudRate });
        }}
        aria-label="Serial baud rate"
        title="Serial speed from the controller manual. A wrong value prevents a readable connection."
      />
      <span style={mutedInlineStyle}>default {props.guide.defaultBaudRate}</span>
    </Row>
  );
}

function AdvancedConnection(props: {
  readonly state: DeviceSetupStepProps['state'];
  readonly controllerKind: ControllerKind;
  readonly update: (patch: Partial<DeviceProfile>) => void;
}): JSX.Element {
  const guide = machineSetupControllerGuide(props.controllerKind);
  const pingPongOnly = props.controllerKind === 'marlin' || props.controllerKind === 'smoothieware';
  return (
    <details style={detailsStyle}>
      <summary
        style={summaryStyle}
        title="Show or hide controller streaming and receive-window settings."
      >
        Advanced connection and streaming
      </summary>
      <div style={settingsStyle}>
        <Row label="Streaming">
          <select
            aria-label="Streaming mode"
            title="Choose whether commands use a buffered receive window or wait for each acknowledgement."
            value={props.state.draft.streamingMode}
            disabled={pingPongOnly}
            onChange={(event) =>
              props.update({ streamingMode: event.target.value as DeviceProfile['streamingMode'] })
            }
          >
            <option value="char-counted">Buffered receive window</option>
            <option value="ping-pong">One acknowledged line at a time</option>
          </select>
        </Row>
        {props.state.draft.streamingMode === 'char-counted' ? (
          <RxWindowRow state={props.state} update={props.update} />
        ) : null}
        <p style={mutedStyle}>{guide.streamingExplanation}</p>
      </div>
    </details>
  );
}

function RxWindowRow(props: {
  readonly state: DeviceSetupStepProps['state'];
  readonly update: (patch: Partial<DeviceProfile>) => void;
}): JSX.Element {
  return (
    <Row label="RX window">
      <input
        type="number"
        min={1}
        max={4096}
        step={1}
        value={props.state.draft.rxBufferBytes}
        onChange={(event) => {
          const rxBufferBytes = Number(event.target.value);
          if (Number.isFinite(rxBufferBytes) && rxBufferBytes > 0)
            props.update({ rxBufferBytes: Math.floor(rxBufferBytes) });
        }}
        aria-label="Controller receive window bytes"
        title="Set the controller receive-buffer allowance used by buffered streaming."
      />
      <span style={mutedInlineStyle}>bytes</span>
    </Row>
  );
}

function ProfileImport({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  return (
    <details style={detailsStyle}>
      <summary style={summaryStyle} title="Show or hide machine-profile import and export tools.">
        Import or export a machine profile
      </summary>
      <p style={mutedStyle}>
        Imports are reviewed and loaded into this draft. Nothing changes in the project until the
        final Save machine setup button.
      </p>
      <ImportExportPanel
        profile={machineSetupProfile(state)}
        onApply={(profile) => dispatch({ kind: 'apply-preset', profile })}
      />
    </details>
  );
}

function ProfileCatalog({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const suggestions = suggestMachineProfiles({
    detectedControllerKind: state.detectedControllerKind ?? null,
    detectedProfilePatch: state.detected,
    controllerSettings: state.controllerRead ? state.detected : null,
    settingsRows: [],
  });
  return (
    <details style={detailsStyle} open={shouldAdvise4040FillPolicySelection(state.draft)}>
      <summary style={summaryStyle} title="Show or hide reviewed machine-profile suggestions.">
        Start from a reviewed machine profile
      </summary>
      <p style={mutedStyle}>
        A profile supplies useful defaults. You will still review work area, origin, homing, power,
        and accessories before saving.
      </p>
      <div style={catalogGridStyle}>
        {suggestions.map((suggestion) => (
          <PresetCard
            key={suggestion.profileId}
            suggestion={suggestion}
            isActive={profilePresetIsActive(state.draft, suggestion)}
            onUse={() => dispatch({ kind: 'apply-preset', profile: suggestion.profile })}
          />
        ))}
      </div>
    </details>
  );
}

function profilePresetIsActive(
  draft: DeviceProfile,
  suggestion: MachineProfileSuggestion,
): boolean {
  if (draft.profileId !== suggestion.profile.profileId) return false;
  if (suggestion.profile.profileId !== NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.profileId) return true;
  return fillRunwayPolicyForDevice(draft) !== undefined;
}

function PresetCard(props: {
  readonly suggestion: MachineProfileSuggestion;
  readonly isActive: boolean;
  readonly onUse: () => void;
}): JSX.Element {
  const profile = props.suggestion.profile;
  const buttonTitle = props.isActive
    ? 'This machine is selected.'
    : `Start from ${profile.name}'s defaults.`;
  const buttonLabel = props.isActive ? 'Selected' : `Use ${profile.name}`;
  return (
    <article style={cardStyle}>
      <div style={cardHeaderStyle}>
        <strong>{profile.name}</strong>
        <span style={buttonRowStyle}>
          <span style={badgeStyle}>{suggestionConfidenceLabel(props.suggestion.confidence)}</span>
          <span style={badgeStyle}>{profileConfidenceLabel(profile)}</span>
        </span>
      </div>
      <p style={mutedStyle}>
        {profile.bedWidth} × {profile.bedHeight} mm
        {profile.laserSubProfile?.opticalPowerW !== undefined
          ? `, ${profile.laserSubProfile.opticalPowerW} W`
          : ''}
      </p>
      <ul style={notesStyle}>
        {props.suggestion.entry.reviewNotes.slice(0, 2).map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <Button
        variant={props.isActive ? 'default' : 'primary'}
        disabled={props.isActive}
        onClick={props.onUse}
        title={buttonTitle}
      >
        {buttonLabel}
      </Button>
    </article>
  );
}

function suggestionConfidenceLabel(confidence: MachineProfileSuggestion['confidence']): string {
  if (confidence === 'suggested') return 'Suggested match';
  if (confidence === 'possible') return 'Possible match';
  return 'Manual choice';
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const introStyle: React.CSSProperties = { display: 'grid', gap: 4, fontSize: 12, lineHeight: 1.45 };
const settingsStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const mutedInlineStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 11 };
const warningStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-warning)',
  fontSize: 12,
  fontWeight: 600,
};
const detailsStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 8,
};
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12, fontWeight: 600 };
