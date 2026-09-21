// Machine identity and controller contract. Profile selection precedes the
// optional connection, so the first serial open uses the selected driver/baud.

import {
  GRBL_GCODE_DIALECTS,
  MARLIN_GCODE_DIALECTS,
  type ControllerKind,
  type DeviceProfile,
} from '../../../core/devices';
import { selectControllerDriver } from '../../../core/controllers';
import { isGrblFamilyDriver } from '../../state/laser-disconnect-transaction';
import { mutedStyle } from '../MachineSetupStyles';
import { Row } from '../device-settings-shared';
import { ImportExportPanel } from '../MachineSetupImportExport';
import {
  deviceSetupSupportsMachineKind,
  machineSetupProfile,
  type DeviceSetupStepProps,
} from './device-setup-flow';
import { DeviceSetupCncPreset } from './DeviceSetupCncPreset';
import { DeviceSetupProfilePicker } from './DeviceSetupProfilePicker';
import {
  machineSetupControllerGuide,
  machineSetupControllerGuides,
} from './machine-setup-controller-guide';

export function DeviceSetupIdentifyStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const controllerKind = state.draft.controllerKind ?? 'grbl-v1.1';
  const guide = machineSetupControllerGuide(controllerKind, state.draft.controllerCommandSet);
  const driver = selectControllerDriver(controllerKind, state.draft.controllerCommandSet);
  const update = (patch: Partial<DeviceProfile>): void => dispatch({ kind: 'edit', patch });
  return (
    <section style={sectionStyle}>
      {deviceSetupSupportsMachineKind(state, 'laser') ? (
        <DeviceSetupProfilePicker state={state} dispatch={dispatch} />
      ) : null}
      <DeviceSetupCncPreset state={state} dispatch={dispatch} />
      <details className="lf-setup-disclosure">
        <summary title="Choose the controller firmware, output dialect and serial connection settings.">
          <span>Controller and connection settings</span>
          <small>{guide.label} · change if needed</small>
        </summary>
        <div className="lf-setup-disclosure-body">
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
        </div>
      </details>
      <ProfileImport state={state} dispatch={dispatch} />
    </section>
  );
}

function ControllerContract(props: {
  readonly state: DeviceSetupStepProps['state'];
  readonly controllerKind: ControllerKind;
  readonly dispatch: DeviceSetupStepProps['dispatch'];
  readonly update: (patch: Partial<DeviceProfile>) => void;
}): JSX.Element {
  const guide = machineSetupControllerGuide(
    props.controllerKind,
    props.state.draft.controllerCommandSet,
  );
  const driver = selectControllerDriver(
    props.controllerKind,
    props.state.draft.controllerCommandSet,
  );
  const dialects = props.controllerKind === 'marlin' ? MARLIN_GCODE_DIALECTS : GRBL_GCODE_DIALECTS;
  return (
    <div className="lf-setup-fields" style={settingsStyle}>
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
  const guide = machineSetupControllerGuide(
    props.controllerKind,
    props.state.draft.controllerCommandSet,
  );
  const pingPongOnly = props.controllerKind === 'marlin' || props.controllerKind === 'smoothieware';
  return (
    <details className="lf-setup-disclosure lf-setup-disclosure--nested">
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
        {isGrblFamilyDriver(selectControllerDriver(props.controllerKind)) ? (
          <HostedStreamingRow state={props.state} update={props.update} />
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
        title="Set the controller receive-buffer allowance used by buffered streaming. Start never streams more than the capacity the controller reports; grblHAL profiles default to 1024 bytes."
      />
      <span style={mutedInlineStyle}>bytes</span>
    </Row>
  );
}

// ADR-334. Off by default and labelled as untested on purpose: the worker
// transport has no runtime coverage in this repository and no hardware
// evidence, so an operator turning it on is choosing to try it.
function HostedStreamingRow(props: {
  readonly state: DeviceSetupStepProps['state'];
  readonly update: (patch: Partial<DeviceProfile>) => void;
}): JSX.Element {
  return (
    <Row label="Stream in worker">
      <input
        type="checkbox"
        checked={props.state.draft.workerHostedStreaming === true}
        aria-label="Read the serial port and refill the job stream in a worker"
        title="Experimental, untested on hardware. Reads the port and writes job refills off the main thread, so a busy interface cannot delay the controller. A browser that cannot hand the port to a worker keeps the normal transport."
        onChange={(event) => props.update({ workerHostedStreaming: event.target.checked })}
      />
      <span style={mutedInlineStyle}>experimental, untested on hardware</span>
    </Row>
  );
}

function ProfileImport({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  return (
    <details className="lf-setup-disclosure">
      <summary style={summaryStyle} title="Show or hide machine-profile import and export tools.">
        Import or export a machine profile
      </summary>
      <p style={mutedStyle}>
        Load a saved profile into this draft, or export your current choices.
      </p>
      <ImportExportPanel
        profile={machineSetupProfile(state)}
        onApply={(profile) => dispatch({ kind: 'apply-preset', profile })}
      />
    </details>
  );
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const settingsStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const mutedInlineStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 11 };
const warningStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-warning-fg)',
  fontSize: 12,
  fontWeight: 600,
};
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12, fontWeight: 600 };
