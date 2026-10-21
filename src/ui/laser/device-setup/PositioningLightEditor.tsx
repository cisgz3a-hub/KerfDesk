import type { ControllerKind, DeviceProfile } from '../../../core/devices';
import {
  devicePositioningLightIssue,
  FALCON_POINTER_COMMAND_SET,
  FALCON_POINTER_LIGHT,
  isFalconPointerLight,
  type FalconPointerLight,
  type GcodePositioningLight,
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
  if (device.controllerKind === 'ruida') {
    return (
      <p>
        Ruida uses file output in KerfDesk. Live positioning and light control are unavailable; use
        the machine panel.
      </p>
    );
  }
  const value = device.positioningLight;
  const issue = devicePositioningLightIssue(device);
  // The Falcon A1 Pro's pointer has no G-code; Creality switches it over the
  // machine's network link, so there is nothing to type (ADR-635).
  if (device.controllerCommandSet === FALCON_POINTER_COMMAND_SET && !isGcodeLight(value))
    return <FalconPointerEditor value={value} issue={issue} onChange={onChange} />;
  if (isFalconPointerLight(value))
    return <ForeignFalconPointer issue={issue} onChange={onChange} />;
  return <GcodeLightEditor device={device} value={value} issue={issue} onChange={onChange} />;
}

function isGcodeLight(value: PositioningLight | undefined): value is GcodePositioningLight {
  return value !== undefined && !isFalconPointerLight(value);
}

function FalconPointerEditor(props: {
  readonly value: FalconPointerLight | undefined;
  readonly issue: string | null;
  readonly onChange: LightChange;
}): JSX.Element {
  const { value, onChange } = props;
  return (
    <div style={{ display: 'grid', gap: 8, fontSize: 12 }}>
      <label>
        <input
          type="checkbox"
          title="Use the red pointer on the Falcon’s laser head for LED on, LED off and Centre & LED."
          checked={value !== undefined}
          onChange={(event) => onChange(event.target.checked ? FALCON_POINTER_LIGHT : undefined)}
        />{' '}
        Use the Falcon’s red pointer
      </label>
      <p style={{ margin: 0 }}>
        Nothing to type. KerfDesk switches the pointer the way Creality’s software does, over the
        Falcon’s own network link (the one its camera uses), so it needs KerfDesk Desktop.
      </p>
      {value !== undefined ? (
        <>
          <p style={{ margin: 0 }}>
            Leave the offsets at 0 when the red dot sits on the laser spot. Otherwise enter the dot
            position minus the laser spot, along the canvas bed axes.
          </p>
          <OffsetFields value={value} onChange={onChange} />
          <AfterFrameField value={value} onChange={onChange} />
          <IssueText issue={props.issue} />
        </>
      ) : null}
    </div>
  );
}

function ForeignFalconPointer(props: {
  readonly issue: string | null;
  readonly onChange: LightChange;
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 8, fontSize: 12 }}>
      <IssueText issue={props.issue} />
      <button
        type="button"
        className="lf-btn"
        title="Remove the Falcon red pointer from this profile; it only works on the Falcon A1 Pro profile."
        onClick={() => props.onChange(undefined)}
      >
        Remove the Falcon pointer
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
      device.controllerCommandSet !== FALCON_POINTER_COMMAND_SET ? (
        <p style={{ margin: 0 }}>
          A Creality Falcon A1 Pro? Choose its own machine profile to use its red pointer with
          nothing to type.
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

function OffsetFields<T extends PositioningLight>(props: {
  readonly value: T;
  readonly onChange: (value: T) => void;
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
        title="After Frame finishes, automatically show the centre of the whole framed job on the board, using its captured placement and LED offsets. The LED stays on until switched off, and Frame stays valid for Start."
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
  }
}

const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '150px minmax(0, 1fr)',
  alignItems: 'center',
  gap: 8,
};
