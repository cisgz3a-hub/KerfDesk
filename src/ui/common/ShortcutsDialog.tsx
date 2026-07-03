// ShortcutsDialog — the keyboard-shortcut reference. The toolbar used to
// expose this list only as a hover tooltip on a plain-text "shortcuts" hint;
// a real dialog is discoverable, readable, and works on touch devices.

import type { MachineKind } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';
import { shortcutFamilies } from './shortcut-list';

export function ShortcutsDialog(props: {
  readonly machineKind: MachineKind;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <Dialog title="Keyboard Shortcuts" size="lg" onClose={props.onClose}>
      <div style={columnsStyle}>
        {shortcutFamilies(props.machineKind).map((entry) => (
          <section key={entry.family} style={familyStyle}>
            <h3 style={familyHeadingStyle}>{entry.family}</h3>
            <dl style={rowsStyle}>
              {entry.rows.map((row) => (
                <div key={row.keys} style={rowStyle}>
                  <dt style={keysStyle}>
                    <kbd style={kbdStyle}>{row.keys}</kbd>
                  </dt>
                  <dd style={actionStyle}>{row.action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <DialogActions>
        <Button onClick={props.onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

const columnsStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '10px 24px',
};
const familyStyle: React.CSSProperties = { minWidth: 0 };
const familyHeadingStyle: React.CSSProperties = { margin: '4px 0 6px', fontSize: 13 };
const rowsStyle: React.CSSProperties = { margin: 0 };
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  padding: '1px 0',
};
const keysStyle: React.CSSProperties = { flexShrink: 0 };
const kbdStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 11,
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '0 4px',
  background: 'var(--lf-bg-2)',
};
const actionStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-muted)' };
