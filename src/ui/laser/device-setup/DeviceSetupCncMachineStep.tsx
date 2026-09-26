import {
  isCncCoolantMode,
  type CncMachineConfig,
  type CncMachineParams,
} from '../../../core/scene';
import { NumberField } from '../../common/NumberField';
import { Row, numInputStyle, unitStyle } from '../device-settings-shared';
import type { DeviceSetupStepProps } from './device-setup-flow';
import { MachineSetupFieldAnchor } from './machine-setup-field-anchor';

export function DeviceSetupCncMachineStep(props: {
  readonly state: DeviceSetupStepProps['state'];
  readonly dispatch: DeviceSetupStepProps['dispatch'];
  readonly machine: CncMachineConfig;
}): JSX.Element {
  const setParams = (params: CncMachineParams): void => {
    props.dispatch({ kind: 'edit-machine', machine: { ...props.machine, params } });
  };
  const updateParams = (patch: Partial<CncMachineParams>): void => {
    setParams({ ...props.machine.params, ...patch });
  };
  return (
    <section style={sectionStyle} aria-label="CNC machine limits">
      <div style={introStyle}>
        <strong>CNC machine limits</strong>
        <span>
          These machine-owned values control retracts, spindle output, dwell, coolant commands, and
          end or tool-change parking. A park is a bed position that moves with the job like every
          cut, and a job whose place on the bed is unknown parks at its origin instead. With no
          park, a Current Position job returns to its start and any other job ends at program X0 Y0.
          CNC mode assumes an installed, powered Z axis; choosing CNC does not prove Z hardware or
          direction. Recorded Z travel is informational. Artwork chooses its running spindle speed
          separately.
        </span>
      </div>
      <CncParameterRows machine={props.machine} updateParams={updateParams} setParams={setParams} />
      <div style={warningStyle}>
        <strong>Hardware check required:</strong> confirm a powered Z is installed, Z-positive moves
        away from the stock, Safe Z clears clamps, M3/S reaches the expected RPM, the dwell is long
        enough, and M7/M8 drives only the intended coolant output. These are warnings, not a mode or
        Start gate.
      </div>
    </section>
  );
}

function CncParameterRows(props: {
  readonly machine: CncMachineConfig;
  readonly updateParams: (patch: Partial<CncMachineParams>) => void;
  readonly setParams: (params: CncMachineParams) => void;
}): JSX.Element {
  const { machine, updateParams } = props;
  return (
    <>
      <MachineSetupFieldAnchor field="safe-z" label="Safe Z in Machine Setup">
        <MachineNumberRow
          label="Safe Z"
          unit="mm"
          value={machine.params.safeZMm}
          min={0.5}
          max={50}
          step={0.5}
          onCommit={(safeZMm) => updateParams({ safeZMm })}
        />
      </MachineSetupFieldAnchor>
      <MachineSetupFieldAnchor field="spindle-max" label="Spindle maximum in Machine Setup">
        <MachineNumberRow
          label="Spindle maximum"
          unit="RPM"
          value={machine.params.spindleMaxRpm}
          min={1000}
          max={60000}
          step={500}
          onCommit={(spindleMaxRpm) => updateParams({ spindleMaxRpm })}
        />
      </MachineSetupFieldAnchor>
      <MachineSetupFieldAnchor field="spinup" label="Spin-up delay in Machine Setup">
        <MachineNumberRow
          label="Spin-up delay"
          unit="s"
          value={machine.params.spindleSpinupSec}
          min={0}
          max={30}
          step={0.1}
          onCommit={(spindleSpinupSec) => updateParams({ spindleSpinupSec })}
        />
      </MachineSetupFieldAnchor>
      <MachineSetupFieldAnchor field="coolant" label="Coolant in Machine Setup">
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
      </MachineSetupFieldAnchor>
      <ParkRows machine={machine} setParams={props.setParams} />
    </>
  );
}

// No park is its own state, not X0 Y0 (CNC audit MC-7): 0, 0 is a real bed
// position since ADR-392, so the fields sit behind a toggle that removes both.
function ParkRows(props: {
  readonly machine: CncMachineConfig;
  readonly setParams: (params: CncMachineParams) => void;
}): JSX.Element {
  const { params } = props.machine;
  const parked = params.parkXMm !== undefined || params.parkYMm !== undefined;
  const setParked = (on: boolean): void => {
    const { parkXMm, parkYMm, ...unparked } = params;
    props.setParams(on ? { ...unparked, parkXMm: parkXMm ?? 0, parkYMm: parkYMm ?? 0 } : unparked);
  };
  return (
    <MachineSetupFieldAnchor field="park" label="Park position in Machine Setup">
      <label style={checkRowStyle}>
        <input
          type="checkbox"
          checked={parked}
          onChange={(event) => setParked(event.target.checked)}
          aria-label="Park at a bed position"
          title="Park at a bed position after the job and at planned bit changes."
        />
        <span>Park at a bed position after the job and at bit changes</span>
      </label>
      {parked ? (
        <>
          <MachineNumberRow
            label="Park X"
            unit="mm"
            value={params.parkXMm ?? 0}
            min={-1500}
            max={1500}
            step={1}
            onCommit={(parkXMm) => props.setParams({ ...params, parkXMm })}
          />
          <MachineNumberRow
            label="Park Y"
            unit="mm"
            value={params.parkYMm ?? 0}
            min={-1500}
            max={1500}
            step={1}
            onCommit={(parkYMm) => props.setParams({ ...params, parkYMm })}
          />
        </>
      ) : null}
    </MachineSetupFieldAnchor>
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
        debounceMs={0}
      />
      <span style={unitStyle}>{props.unit}</span>
    </Row>
  );
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const introStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  fontSize: 12,
  lineHeight: 1.45,
  marginBottom: 2,
};
const checkRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
};
const warningStyle: React.CSSProperties = {
  border: '1px solid var(--lf-warning)',
  borderRadius: 6,
  padding: 8,
  fontSize: 12,
  lineHeight: 1.45,
  color: 'var(--lf-warning-fg)',
};
