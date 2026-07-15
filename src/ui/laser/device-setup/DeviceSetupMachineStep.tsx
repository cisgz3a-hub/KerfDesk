// Step 4: machine-process settings. Laser and CNC deliberately render
// different controls; job-specific stock/material/bit settings stay in the
// project rail and are not confused with persistent machine configuration.

import { selectControllerDriver } from '../../../core/controllers';
import {
  isCncCoolantMode,
  type CncMachineConfig,
  type CncMachineParams,
} from '../../../core/scene';
import type { DeviceProfile } from '../../../core/devices';
import { NumberField } from '../../common/NumberField';
import { AirAssistRow, FireControlRow, LaserPowerRows } from '../DeviceProfilePowerFields';
import { Row, numInputStyle, unitStyle } from '../device-settings-shared';
import { deviceSetupSupportsMachineKind, type DeviceSetupStepProps } from './device-setup-flow';

export function DeviceSetupMachineStep(props: DeviceSetupStepProps): JSX.Element {
  return (
    <div style={outputStackStyle}>
      {deviceSetupSupportsMachineKind(props.state, 'laser') ? (
        <LaserMachineStep {...props} />
      ) : null}
      {deviceSetupSupportsMachineKind(props.state, 'cnc') ? (
        <CncMachineStep {...props} machine={props.state.cncDraft} />
      ) : null}
    </div>
  );
}

function LaserMachineStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const driver = selectControllerDriver(state.draft.controllerKind);
  const update = (patch: Partial<DeviceProfile>): void => dispatch({ kind: 'edit', patch });
  return (
    <section style={sectionStyle}>
      <div style={introStyle}>
        <strong>Laser output and accessories</strong>
        <span>
          The S range converts percentages into controller power values. Air and low-power Fire
          remain disabled unless you explicitly configure and hardware-test them.
        </span>
      </div>
      <LaserPowerRows
        device={state.draft}
        update={update}
        grblLabels={driver.capabilities.settings === 'grbl-dollar'}
      />
      <AirAssistRow device={state.draft} update={update} />
      <FireControlRow device={state.draft} update={update} />
      <div style={warningStyle}>
        <strong>Hardware check required:</strong> verify the beam is off at S0, test the lowest
        usable power on scrap, and confirm whether M7 or M8 operates the intended air relay.
      </div>
    </section>
  );
}

function CncMachineStep({
  dispatch,
  machine,
}: DeviceSetupStepProps & { readonly machine: CncMachineConfig }): JSX.Element {
  const updateParams = (patch: Partial<CncMachineParams>): void => {
    const next = { ...machine, params: { ...machine.params, ...patch } };
    dispatch({ kind: 'edit-machine', machine: next });
  };
  return (
    <section style={sectionStyle}>
      <div style={introStyle}>
        <strong>CNC clearance and spindle contract</strong>
        <span>
          These values control retracts, spindle output, dwell before plunging, coolant commands,
          and end/tool-change parking. Stock, material, and bit remain per-project settings.
        </span>
      </div>
      <CncParameterRows machine={machine} updateParams={updateParams} />
      <div style={warningStyle}>
        <strong>Hardware check required:</strong> confirm Z-positive moves away from the stock, Safe
        Z clears clamps, M3/S reaches the expected RPM, the dwell is long enough, and M7/M8 drives
        only the intended coolant output.
      </div>
    </section>
  );
}

function CncParameterRows(props: {
  readonly machine: CncMachineConfig;
  readonly updateParams: (patch: Partial<CncMachineParams>) => void;
}): JSX.Element {
  const { machine, updateParams } = props;
  return (
    <>
      <MachineNumberRow
        label="Safe Z"
        unit="mm"
        value={machine.params.safeZMm}
        min={0.5}
        max={50}
        step={0.5}
        onCommit={(safeZMm) => updateParams({ safeZMm })}
      />
      <MachineNumberRow
        label="Spindle maximum"
        unit="RPM"
        value={machine.params.spindleMaxRpm}
        min={1000}
        max={60000}
        step={500}
        onCommit={(spindleMaxRpm) => updateParams({ spindleMaxRpm })}
      />
      <MachineNumberRow
        label="Spin-up delay"
        unit="s"
        value={machine.params.spindleSpinupSec}
        min={0}
        max={30}
        step={0.1}
        onCommit={(spindleSpinupSec) => updateParams({ spindleSpinupSec })}
      />
      <Row label="Coolant">
        <select
          value={machine.params.coolant ?? 'off'}
          onChange={(event) =>
            updateParams({
              coolant: isCncCoolantMode(event.target.value) ? event.target.value : 'off',
            })
          }
          aria-label="CNC coolant output"
          title="Choose the coolant command emitted for CNC jobs, or keep coolant off."
        >
          <option value="off">Off</option>
          <option value="mist">Mist (M7)</option>
          <option value="flood">Flood (M8)</option>
        </select>
      </Row>
      <MachineNumberRow
        label="Park X"
        unit="mm"
        value={machine.params.parkXMm ?? 0}
        min={-1500}
        max={1500}
        step={1}
        onCommit={(parkXMm) => updateParams({ parkXMm })}
      />
      <MachineNumberRow
        label="Park Y"
        unit="mm"
        value={machine.params.parkYMm ?? 0}
        min={-1500}
        max={1500}
        step={1}
        onCommit={(parkYMm) => updateParams({ parkYMm })}
      />
    </>
  );
}

function MachineNumberRow(props: {
  readonly label: string;
  readonly unit: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  return (
    <Row label={props.label}>
      <NumberField
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onCommit={props.onCommit}
        style={numInputStyle}
        ariaLabel={props.label}
        title={props.label}
      />
      <span style={unitStyle}>{props.unit}</span>
    </Row>
  );
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const outputStackStyle: React.CSSProperties = { display: 'grid', gap: 14 };
const introStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  fontSize: 12,
  lineHeight: 1.45,
  marginBottom: 2,
};
const warningStyle: React.CSSProperties = {
  border: '1px solid var(--lf-warning)',
  borderRadius: 6,
  padding: 8,
  fontSize: 12,
  lineHeight: 1.45,
  color: 'var(--lf-warning)',
};
