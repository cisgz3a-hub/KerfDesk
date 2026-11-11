import type { ControllerKind, DeviceProfile } from '../../../core/devices';
import { HARD_MAX_FIRE_POWER_PERCENT } from '../../../core/devices/fire-control';
import {
  devicePositioningLightIssue,
  isLaserDotLight,
  LASER_DOT_AUTO_OFF_MS,
  LASER_DOT_COMMAND_SET,
  LASER_DOT_LIGHT,
  laserDotModuleIssue,
  type GcodePositioningLight,
  type LaserDotLight,
  type PositioningLight,
} from '../../../core/devices/positioning-light';

const EMPTY_LIGHT: GcodePositioningLight = {
  onCommand: '',
  offCommand: '',
  offsetXmm: 0,
  offsetYmm: 0,
};

type LightChange = (positioningLight: PositioningLight | undefined) => void;

export function PositioningLightEditor({
  device,
  onChange,
}: {
  readonly device: DeviceProfile;
  readonly onChange: LightChange;
}): JSX.Element {
  if (device.controllerKind === 'moshi') {
    return (
      <p>
        A Moshiboard has no light or pointer command KerfDesk can send. Use the switch on the
        machine.
      </p>
    );
  }
  if (device.controllerKind === 'ruida' || device.controllerKind === 'lihuiyu') {
    return (
      <p>
        This controller runs from files or its own link in KerfDesk. Live positioning and light
        control are unavailable; use the machine panel.
      </p>
    );
  }
  const value = device.positioningLight;
  const issue = devicePositioningLightIssue(device);
  // The Falcon A1 Pro's head has no separate LED: its LED is the laser itself
  // at low power, as Creality's "Laser on" button does (ADR-664).
  if (device.controllerCommandSet === LASER_DOT_COMMAND_SET && !isGcodeLight(value))
    return (
      <LaserDotEditor
        value={value}
        issue={issue}
        moduleIssue={laserDotModuleIssue(device)}
        onChange={onChange}
      />
    );
  if (isLaserDotLight(value)) return <ForeignLaserDot issue={issue} onChange={onChange} />;
  return <GcodeLightEditor device={device} value={value} issue={issue} onChange={onChange} />;
}

function isGcodeLight(value: PositioningLight | undefined): value is GcodePositioningLight {
  return value !== undefined && !isLaserDotLight(value);
}

function LaserDotEditor(props: {
  readonly value: LaserDotLight | undefined;
  readonly issue: string | null;
  readonly moduleIssue: string | null;
  readonly onChange: LightChange;
}): JSX.Element {
  const { value, onChange } = props;
  return (
    <div style={{ display: 'grid', gap: 8, fontSize: 12 }}>
      <label>
        <input
          type="checkbox"
          title="LED on, LED off and Centre & LED turn the laser itself on at low power, as the “Laser on” button in Creality’s software does."
          checked={value !== undefined}
          onChange={(event) => onChange(event.target.checked ? LASER_DOT_LIGHT : undefined)}
        />{' '}
        Show where it will burn with the laser at low power
      </label>
      <p style={{ margin: 0 }}>
        The Falcon A1 Pro’s laser head has no separate LED. Like Creality’s “Laser on” button, LED
        on turns the laser itself on at low power, so its dot is exactly where it will burn.
        KerfDesk requests off after {LASER_DOT_AUTO_OFF_MS / 1000} s while the app and connection
        remain responsive. LED off or LASER OFF requests off sooner. Use the machine stop if the
        beam remains on.
      </p>
      {value !== undefined ? (
        <>
          <p role="note" style={{ margin: 0, color: 'var(--lf-danger)' }}>
            This is the cutting laser. Wear laser safety glasses or watch through the lid, and keep
            the power low: even a few percent can mark paper or card while the head is stationary.
          </p>
          <DotPowerField value={value} onChange={onChange} />
          <AfterFrameField value={value} onChange={onChange} />
          <IssueText issue={props.issue ?? props.moduleIssue} />
        </>
      ) : null}
    </div>
  );
}

function DotPowerField(props: {
  readonly value: LaserDotLight;
  readonly onChange: (value: LaserDotLight) => void;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      Dot power (%)
      <input
        type="number"
        title={`Laser power for the dot. 1% is usually enough to see it; KerfDesk never allows more than ${HARD_MAX_FIRE_POWER_PERCENT}%.`}
        min={0.1}
        max={HARD_MAX_FIRE_POWER_PERCENT}
        step={0.1}
        value={Number.isFinite(props.value.powerPercent) ? props.value.powerPercent : ''}
        onChange={(event) =>
          props.onChange({ ...props.value, powerPercent: event.target.valueAsNumber })
        }
      />
    </label>
  );
}

function ForeignLaserDot(props: {
  readonly issue: string | null;
  readonly onChange: LightChange;
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 8, fontSize: 12 }}>
      <IssueText issue={props.issue} />
      <button
        type="button"
        className="lf-btn"
        title="Remove the laser dot from this profile; it only works on the Falcon A1 Pro profile."
        onClick={() => props.onChange(undefined)}
      >
        Remove the laser dot
      </button>
    </div>
  );
}

function GcodeLightEditor(props: {
  readonly device: DeviceProfile;
  readonly value: GcodePositioningLight | undefined;
  readonly issue: string | null;
  readonly onChange: LightChange;
}): JSX.Element {
  const { device, value, onChange } = props;
  return (
    <div style={{ display: 'grid', gap: 8, fontSize: 12 }}>
      <label>
        <input
          type="checkbox"
          title="Enable explicit command and offset settings for a separately wired positioning light."
          checked={value !== undefined}
          onChange={(event) => onChange(event.target.checked ? EMPTY_LIGHT : undefined)}
        />{' '}
        Configure a separate LED / crosshair
      </label>
      <p style={{ margin: 0 }}>
        Use only commands documented for your dedicated positioning light and its wiring. This does
        not configure the cutting laser. A manually switched light must be operated on the machine.
      </p>
      {device.machineFamily === 'creality-falcon' &&
      device.controllerCommandSet !== LASER_DOT_COMMAND_SET ? (
        <p style={{ margin: 0 }}>
          A Creality Falcon A1 Pro? Choose its own machine profile to show where it will burn with
          the laser at low power, with nothing to type.
        </p>
      ) : null}
      {value !== undefined ? (
        <>
          <p style={{ margin: 0 }}>{commandHelp(device.controllerKind)}</p>
          <CommandField
            label="Light on command"
            value={value.onCommand}
            onChange={(onCommand) => onChange({ ...value, onCommand })}
          />
          <CommandField
            label="Light off command"
            value={value.offCommand}
            onChange={(offCommand) => onChange({ ...value, offCommand })}
          />
          <p style={{ margin: 0 }}>
            Offsets are the pointer spot minus the laser spot, along the canvas bed axes. For a
            pointer 10 mm to the right, enter X +10; the head moves 10 mm left so the pointer lands
            at the trace centre.
          </p>
          <OffsetFields value={value} onChange={onChange} />
          <AfterFrameField value={value} onChange={onChange} />
          <IssueText issue={props.issue} />
        </>
      ) : null}
    </div>
  );
}

function IssueText({ issue }: { readonly issue: string | null }): JSX.Element | null {
  return issue === null ? null : (
    <p role="alert" style={{ margin: 0, color: 'var(--lf-danger)' }}>
      {issue}
    </p>
  );
}

function OffsetFields(props: {
  readonly value: GcodePositioningLight;
  readonly onChange: (value: GcodePositioningLight) => void;
}): JSX.Element {
  const { value, onChange } = props;
  return (
    <>
      <OffsetField
        axis="X"
        value={value.offsetXmm}
        onChange={(offsetXmm) => onChange({ ...value, offsetXmm })}
      />
      <OffsetField
        axis="Y"
        value={value.offsetYmm}
        onChange={(offsetYmm) => onChange({ ...value, offsetYmm })}
      />
    </>
  );
}

function AfterFrameField<T extends PositioningLight>(props: {
  readonly value: T;
  readonly onChange: (value: T) => void;
}): JSX.Element {
  return (
    <label>
      <input
        type="checkbox"
        title={
          isLaserDotLight(props.value)
            ? `After Frame finishes, move with the beam off to the centre of the whole framed job and turn the laser dot on there. KerfDesk requests off after ${LASER_DOT_AUTO_OFF_MS / 1000} s while the app and connection remain responsive; switch it off before Start. Frame stays valid for Start.`
            : 'After Frame finishes, automatically show the centre of the whole framed job on the board, using its captured placement and LED offsets. The LED stays on until switched off, and Frame stays valid for Start.'
        }
        checked={props.value.afterFrame === true}
        onChange={(event) => {
          const { afterFrame: _previous, ...rest } = props.value;
          props.onChange((event.target.checked ? { ...rest, afterFrame: true } : rest) as T);
        }}
      />{' '}
      Centre &amp; LED after Frame
    </label>
  );
}

function CommandField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      {props.label}
      <input
        type="text"
        title={`${props.label}: enter the documented command for the dedicated light output.`}
        maxLength={100}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        spellCheck={false}
      />
    </label>
  );
}

function OffsetField(props: {
  readonly axis: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      {props.axis} offset (mm)
      <input
        type="number"
        title={`${props.axis} pointer spot minus cutting spot, in canvas bed millimetres.`}
        min={-1000}
        max={1000}
        step="any"
        value={Number.isFinite(props.value) ? props.value : ''}
        onChange={(event) => props.onChange(event.target.valueAsNumber)}
      />
    </label>
  );
}

function commandHelp(kind: ControllerKind | undefined): string {
  switch (kind) {
    case 'grblhal':
    case 'fluidnc':
      return 'Configured digital outputs may use M64 Pn / M65 Pn. Replace n with the output assigned to your light; verify its polarity and firmware configuration.';
    case 'marlin':
      return 'M355 S1 P255 / M355 S0 works only when CASE_LIGHT_ENABLE is built into your firmware and its output is wired to this positioning light.';
    case 'smoothieware':
      return 'Use the input_on_command and input_off_command M-codes assigned to your light in the firmware switch configuration. Configured subcodes such as M106.1 / M107.1 are supported.';
    case undefined:
    case 'grbl-v1.1':
      return 'Stock GRBL has no standard pointer command. Use your machine vendor’s documented accessory commands. M7/M8/M9 are coolant controls unless your machine explicitly maps that output to the separate light.';
    case 'ruida':
      return 'Ruida uses file output; operate the light from the machine panel.';
    case 'jcz-lmc':
      return 'A galvo’s red pointer is its Frame: use Frame in the Galvo USB panel.';
    case 'lihuiyu':
      return 'Lihuiyu boards have no light output; switch the light at the machine.';
    case 'moshi':
      return 'A Moshiboard has no light command; use the machine switch.';
  }
}

const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '150px minmax(0, 1fr)',
  alignItems: 'center',
  gap: 8,
};
