// AutofocusEditor — textarea + one-click presets for the user's
// autofocus command. Extracted from DeviceSettings.tsx so the
// parent stays under the 400-line hard cap (F-1 audit finding).
//
// Single-click presets for the autofocus command. Each preset is the
// minimum the named machine needs; users on something else either paste
// a known command from their controller docs or leave blank to disable.
//
// Falcon: GrblHAL on the Creality "A1 Pro Laser Master" mainboard
// implements `$HZ1` as a single-line firmware macro that runs the
// internal autofocus probe. Requires firmware ≥ 1.0.38; older firmware
// rejects with error:20 (unsupported G-code).

import { inlineCodeStyle } from './device-settings-shared';

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

export function AutofocusEditor(props: {
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
        title="G-code or firmware command KerfDesk sends when auto-focus is requested. Leave blank to disable auto-focus."
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

const focusBlockStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  marginTop: 4,
  borderTop: '1px solid var(--lf-border)',
  paddingTop: 4,
};
const focusLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--lf-text-muted)',
  fontWeight: 500,
};
const textareaStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 11,
  width: '100%',
  boxSizing: 'border-box',
  resize: 'vertical',
};
const focusHintStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--lf-text-faint)',
  margin: '2px 0 0 0',
  fontStyle: 'italic',
};
const presetsRowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 4 };
const presetButtonStyle: React.CSSProperties = {
  fontSize: 10,
  padding: '2px 6px',
  cursor: 'pointer',
};
