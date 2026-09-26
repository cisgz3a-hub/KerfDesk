// Connection options inside Find my machine (ADR-420): the controller firmware,
// baud, output dialect and streaming that the connection uses. Moved from the
// former "Controller and connection settings" disclosure unchanged.

import {
  GRBL_GCODE_DIALECTS,
  MARLIN_GCODE_DIALECTS,
  type ControllerKind,
  type DeviceProfile,
} from '../../../core/devices';
import { selectControllerDriver } from '../../../core/controllers';
import { usePlatformOptional } from '../../app/platform-context';
import { backgroundStreamingPreferenceTitle } from '../../state/laser-background-streaming-notice';
import { isGrblFamilyDriver } from '../../state/laser-disconnect-transaction';
import { mutedStyle } from '../MachineSetupStyles';
import { Row } from '../device-settings-shared';
import { deviceSetupSupportsMachineKind, type DeviceSetupStepProps } from './device-setup-flow';
import {
  machineSetupControllerGuide,
  machineSetupControllerGuides,
} from './machine-setup-controller-guide';

export function DeviceSetupConnectionOptions({
  state,
  dispatch,
}: DeviceSetupStepProps): JSX.Element {
  const controllerKind = state.draft.controllerKind ?? 'grbl-v1.1';
  const guide = machineSetupControllerGuide(controllerKind, state.draft.controllerCommandSet);
  const driver = selectControllerDriver(controllerKind, state.draft.controllerCommandSet);
  const update = (patch: Partial<DeviceProfile>): void => dispatch({ kind: 'edit', patch });
  return (
    <>
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
    </>
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
  const includesCnc = deviceSetupSupportsMachineKind(props.state, 'cnc');
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
              {controllerOptionLabel(item, includesCnc)}
            </option>
          ))}
        </select>
        <span style={mutedInlineStyle}>{guide.transportLabel}</span>
      </Row>
      {driver.capabilities.transport === 'serial' ? (
        <BaudRow state={props.state} guide={guide} update={props.update} />
      ) : null}
      {driver.capabilities.transport === 'serial' ? (
        <OutputDialectRow
          state={props.state}
          controllerKind={props.controllerKind}
          update={props.update}
        />
      ) : null}
    </div>
  );
}

// A setup that includes CNC marks the controllers that cannot run KerfDesk
// CNC jobs (`cncJobs` false), so the operator learns it before a CNC setup on
// one is refused at save (device-setup-flow.ts; controller audit CN-2).
function controllerOptionLabel(
  guide: { readonly label: string; readonly cncSupported: boolean },
  includesCnc: boolean,
): string {
  return includesCnc && !guide.cncSupported ? `${guide.label} — laser only` : guide.label;
}

// The dialect shapes laser output only: every CNC program is emitted in
// KerfDesk's GRBL CNC dialect whatever is chosen here (cnc-grbl-strategy.ts
// ignores it), so a setup that includes CNC names it as the laser dialect
// (controller audit CN-4).
const CNC_DIALECT_HINT = "CNC programs always use KerfDesk's GRBL CNC dialect.";

function OutputDialectRow(props: {
  readonly state: DeviceSetupStepProps['state'];
  readonly controllerKind: ControllerKind;
  readonly update: (patch: Partial<DeviceProfile>) => void;
}): JSX.Element {
  const dialects = props.controllerKind === 'marlin' ? MARLIN_GCODE_DIALECTS : GRBL_GCODE_DIALECTS;
  const includesCnc = deviceSetupSupportsMachineKind(props.state, 'cnc');
  return (
    <Row label={includesCnc ? 'Laser output dialect' : 'Output dialect'}>
      <select
        aria-label={includesCnc ? 'Laser G-code output dialect' : 'G-code output dialect'}
        title={
          includesCnc
            ? `Choose the laser output syntax expected by the selected controller firmware. ${CNC_DIALECT_HINT}`
            : 'Choose the output syntax expected by the selected controller firmware.'
        }
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
      {includesCnc ? <span style={mutedInlineStyle}>{CNC_DIALECT_HINT}</span> : null}
    </Row>
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

// Native worker ownership keeps the window out of the serial round trip.
// The operator can retain the ordinary transport when needed for compatibility.
function HostedStreamingRow(props: {
  readonly state: DeviceSetupStepProps['state'];
  readonly update: (patch: Partial<DeviceProfile>) => void;
}): JSX.Element {
  const platform = usePlatformOptional();
  return (
    <Row label="Background streaming">
      <input
        type="checkbox"
        checked={props.state.draft.workerHostedStreaming !== false}
        aria-label="Read the serial port and refill the job stream in a worker"
        title={backgroundStreamingPreferenceTitle(platform?.id)}
        onChange={(event) => props.update({ workerHostedStreaming: event.target.checked })}
      />
      <span style={mutedInlineStyle}>reconnect to apply</span>
    </Row>
  );
}

const settingsStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const mutedInlineStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 11 };
const warningStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-warning-fg)',
  fontSize: 12,
  fontWeight: 600,
};
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12, fontWeight: 600 };
