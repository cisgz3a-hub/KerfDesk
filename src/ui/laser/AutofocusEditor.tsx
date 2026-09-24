// AutofocusEditor — textarea + one-click presets for the user's
// autofocus command, shown in Machine Setup's Options step.
//
// Single-click presets for the autofocus command. Each preset is one
// controller line the runtime can execute; users on something else either
// paste a known command from their controller docs or leave blank to disable.
//
// Creality's A1 Pro LightBurn device configuration supplies `$HZ1` as its
// autofocus macro. The file does not establish a firmware family or minimum
// version. See the sourced device fields in the 2026-09-19 correction record.

import { inlineCodeStyle } from './device-settings-shared';

const AUTOFOCUS_PRESETS: ReadonlyArray<{
  readonly label: string;
  readonly command: string;
  readonly hint: string;
}> = [
  {
    label: 'Creality Falcon A1 Pro',
    command: '$HZ1',
    hint: 'Uses the $HZ1 macro from Creality’s A1 Pro device configuration. Confirm support for your firmware.',
  },
];

export function AutofocusEditor(props: {
  readonly value: string;
  readonly onChange: (next: string) => void;
}): JSX.Element {
  return (
    <div style={focusBlockStyle}>
      <p style={focusIntroStyle}>
        Choose a known machine preset, or paste one controller command or firmware macro from your
        controller documentation.
      </p>
      <span style={presetLabelStyle}>Known machine presets</span>
      <div style={presetsRowStyle}>
        {AUTOFOCUS_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => props.onChange(p.command)}
            title={p.hint}
            style={presetButtonStyle}
          >
            Use {p.label}
          </button>
        ))}
      </div>
      <label htmlFor="autofocus-cmd" style={focusLabelStyle}>
        Auto-focus command or macro
      </label>
      <textarea
        id="autofocus-cmd"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        rows={5}
        spellCheck={false}
        placeholder="Pick a preset, or paste one controller command or firmware macro"
        title="One G-code or firmware command KerfDesk sends when auto-focus is requested. Leave blank to disable auto-focus."
        style={textareaStyle}
      />
      <p style={focusHintStyle}>
        Only one controller line is supported; multi-step G-code probe sequences are not sent from
        this control. Leave this empty when the machine has no supported auto-focus routine. Common
        error replies: <code style={inlineCodeStyle}>error:9</code> (no probe pin) and{' '}
        <code style={inlineCodeStyle}>error:20</code> (unsupported G-code on this firmware).
      </p>
    </div>
  );
}

const focusBlockStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
};
const focusIntroStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.4,
};
const presetLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  fontWeight: 600,
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
  fontSize: 11,
  padding: '5px 8px',
  cursor: 'pointer',
};
