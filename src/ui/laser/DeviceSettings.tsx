// DeviceSettings — full editor for the active DeviceProfile. Every field
// in DeviceProfile is editable here, including the two that originally
// required hand-editing device-profile.json: origin corner (controls
// Y-flip in toMachineCoords) and homing (controls whether $H is sent
// on connect).
//
// Phase C closure of "settings panel" — kept inline in the Laser rail
// rather than a separate modal page. The fields are few enough that
// a modal would add modality without adding clarity (CLAUDE.md
// "simplicity first").

import type { Origin } from '../../core/devices';
import { useStore } from '../state';

export function DeviceSettings(): JSX.Element {
  const device = useStore((s) => s.project.device);
  const update = useStore((s) => s.updateDeviceProfile);
  return (
    <div style={panelStyle}>
      <h3 style={headingStyle}>Device</h3>
      <Row label="Name">
        <input
          type="text"
          value={device.name}
          onChange={(e) => update({ name: e.target.value })}
          style={textInputStyle}
          aria-label="Device name"
        />
      </Row>
      <Row label="Bed">
        <input
          type="number"
          min={10}
          step={1}
          value={device.bedWidth}
          onChange={(e) => update({ bedWidth: Math.max(10, Number(e.target.value) || 0) })}
          style={numInputStyle}
          aria-label="Bed width (mm)"
        />
        <span style={timesStyle}>×</span>
        <input
          type="number"
          min={10}
          step={1}
          value={device.bedHeight}
          onChange={(e) => update({ bedHeight: Math.max(10, Number(e.target.value) || 0) })}
          style={numInputStyle}
          aria-label="Bed height (mm)"
        />
        <span style={unitStyle}>mm</span>
      </Row>
      <Row label="Origin">
        <OriginSelect value={device.origin} onChange={(origin) => update({ origin })} />
      </Row>
      <Row label="Max feed">
        <input
          type="number"
          min={1}
          step={100}
          value={device.maxFeed}
          onChange={(e) => update({ maxFeed: Math.max(1, Number(e.target.value) || 0) })}
          style={numInputStyle}
          aria-label="Max feed (mm/min)"
        />
        <span style={unitStyle}>mm/min</span>
      </Row>
      <Row label="$30 (max S)">
        <input
          type="number"
          min={1}
          step={1}
          value={device.maxPowerS}
          onChange={(e) =>
            update({ maxPowerS: Math.max(1, Math.floor(Number(e.target.value) || 0)) })
          }
          style={numInputStyle}
          aria-label="GRBL $30 max power S"
        />
      </Row>
      <Row label="Homing">
        <HomingEditor
          enabled={device.homing.enabled}
          direction={device.homing.direction}
          onChange={(homing) => update({ homing })}
        />
      </Row>
      <AutofocusEditor
        value={device.autofocusCommand}
        onChange={(autofocusCommand) => update({ autofocusCommand })}
      />
    </div>
  );
}

const ORIGIN_OPTIONS: ReadonlyArray<{ readonly value: Origin; readonly label: string }> = [
  { value: 'front-left', label: 'Front left' },
  { value: 'front-right', label: 'Front right' },
  { value: 'rear-left', label: 'Rear left' },
  { value: 'rear-right', label: 'Rear right' },
  { value: 'center', label: 'Center' },
];

function OriginSelect(props: {
  readonly value: Origin;
  readonly onChange: (next: Origin) => void;
}): JSX.Element {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as Origin)}
      aria-label="Machine origin corner"
      title="Where (0,0) sits on your machine. Match this to the corner your GRBL homes to — most Falcon / xTool diode lasers are front-left."
    >
      {ORIGIN_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function HomingEditor(props: {
  readonly enabled: boolean;
  readonly direction: Origin;
  readonly onChange: (next: { enabled: boolean; direction: Origin }) => void;
}): JSX.Element {
  return (
    <>
      <label style={inlineLabelStyle} title="If enabled, the Home button sends $H and waits for completion.">
        <input
          type="checkbox"
          checked={props.enabled}
          onChange={(e) => props.onChange({ enabled: e.target.checked, direction: props.direction })}
          aria-label="Homing enabled"
        />
        <span>$H supported</span>
      </label>
      {props.enabled && (
        <select
          value={props.direction}
          onChange={(e) =>
            props.onChange({ enabled: props.enabled, direction: e.target.value as Origin })
          }
          aria-label="Homes to corner"
          title="Which corner the controller homes to. Usually matches the machine origin."
        >
          {ORIGIN_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
    </>
  );
}

// Single-click presets for the autofocus command. Each preset is the
// minimum the named machine needs; users on something else either paste
// a known command from their controller docs or leave blank to disable.
//
// Falcon: GrblHAL on the Creality "A1 Pro Laser Master" mainboard
// implements `$HZ1` as a single-line firmware macro that runs the
// internal autofocus probe. Requires firmware ≥ 1.0.38; older firmware
// rejects with error:20 (unsupported G-code).
const AUTOFOCUS_PRESETS: ReadonlyArray<{
  readonly label: string;
  readonly command: string;
  readonly hint: string;
}> = [
  {
    label: 'Creality Falcon A1 Pro',
    command: '$HZ1',
    hint: 'Firmware ≥ 1.0.38. Older firmware rejects with error:20.',
  },
  {
    label: 'GRBL probe (Z-axis machines)',
    command: 'G91 G21\nG38.2 Z-30 F100\nG92 Z0\nG90\nG1 Z3 F600',
    hint: 'Standard probe-down sequence. Diode lasers without a probe pin reply error:9.',
  },
];

function AutofocusEditor(props: {
  readonly value: string;
  readonly onChange: (next: string) => void;
}): JSX.Element {
  return (
    <div style={focusBlockStyle}>
      <label htmlFor="autofocus-cmd" style={focusLabelStyle}>
        Auto-focus command
      </label>
      <textarea
        id="autofocus-cmd"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        rows={5}
        spellCheck={false}
        placeholder="Pick a preset below, or paste your machine's autofocus command"
        style={textareaStyle}
      />
      <div style={presetsRowStyle}>
        {AUTOFOCUS_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => props.onChange(p.command)}
            title={p.hint}
            style={presetButtonStyle}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p style={focusHintStyle}>
        Empty by default — autofocus protocols are vendor-specific. Pick a preset above for known
        machines, or paste your controller&apos;s command. Common error replies:{' '}
        <code style={inlineCodeStyle}>error:9</code> (no probe pin) and{' '}
        <code style={inlineCodeStyle}>error:20</code> (unsupported G-code on this firmware).
      </p>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={fieldStyle}>{children}</span>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  border: '1px solid #ddd',
  borderRadius: 4,
  padding: 6,
  background: '#fff',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};
const headingStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, margin: 0 };
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
};
const labelStyle: React.CSSProperties = { width: 80, color: '#444' };
const fieldStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, flex: 1 };
const numInputStyle: React.CSSProperties = { width: 64 };
const textInputStyle: React.CSSProperties = { width: 140 };
const unitStyle: React.CSSProperties = { fontSize: 11, color: '#666' };
const timesStyle: React.CSSProperties = { fontSize: 12, color: '#666' };
const focusBlockStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  marginTop: 4,
  borderTop: '1px solid #eee',
  paddingTop: 4,
};
const focusLabelStyle: React.CSSProperties = { fontSize: 12, color: '#444', fontWeight: 500 };
const textareaStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 11,
  width: '100%',
  boxSizing: 'border-box',
  resize: 'vertical',
};
const inlineCodeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, monospace',
  background: '#eee',
  padding: '0 3px',
  borderRadius: 2,
  fontStyle: 'normal',
};
const focusHintStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#777',
  margin: '2px 0 0 0',
  fontStyle: 'italic',
};
const presetsRowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 4 };
const presetButtonStyle: React.CSSProperties = {
  fontSize: 10,
  padding: '2px 6px',
  cursor: 'pointer',
};
const inlineLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  cursor: 'pointer',
};
