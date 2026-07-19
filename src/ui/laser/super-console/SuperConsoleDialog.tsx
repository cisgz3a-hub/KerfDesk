import { useMemo, useState } from 'react';
import { Dialog, DialogActions } from '../../kit/Dialog';
import { useLaserStore } from '../../state/laser-store';
import {
  SUPER_CONSOLE_GROUPS,
  filterSuperConsoleEntries,
  formatSuperConsoleLine,
  type SuperConsoleGroup,
} from './super-console-filters';
import { SuperConsoleTranscriptList } from './SuperConsoleTranscriptList';

const ALL_GROUPS: ReadonlySet<SuperConsoleGroup> = new Set(
  SUPER_CONSOLE_GROUPS.map((group) => group.id),
);

// Read-only expanded console (ADR-229 v1): full transcript with detail
// columns, group filters, and search. Commands are still sent from the
// docked ConsolePanel; this dialog never writes to the controller.
export function SuperConsoleDialog(props: { readonly onClose: () => void }): JSX.Element {
  const transcript = useLaserStore((s) => s.transcript);
  const [groups, setGroups] = useState<ReadonlySet<SuperConsoleGroup>>(ALL_GROUPS);
  const [search, setSearch] = useState('');
  const visible = useMemo(
    () => filterSuperConsoleEntries(transcript, { groups, search }),
    [transcript, groups, search],
  );

  const toggleGroup = (id: SuperConsoleGroup): void => {
    setGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCopy = (): void => {
    void navigator.clipboard?.writeText(visible.map(formatSuperConsoleLine).join('\n'));
  };

  return (
    <Dialog onClose={props.onClose} title="Super console" size="xl">
      <div style={toolbarStyle}>
        {SUPER_CONSOLE_GROUPS.map((group) => (
          <label key={group.id} title={group.hint} style={chipStyle}>
            <input
              type="checkbox"
              checked={groups.has(group.id)}
              onChange={() => toggleGroup(group.id)}
            />
            {group.label}
          </label>
        ))}
        <input
          aria-label="Search console lines"
          placeholder="Search raw or decoded text…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={searchStyle}
        />
        <span style={countStyle}>
          {visible.length} of {transcript.length} lines
        </span>
      </div>
      <SuperConsoleTranscriptList entries={visible} />
      <DialogActions>
        <button type="button" onClick={handleCopy} disabled={visible.length === 0}>
          Copy visible
        </button>
        <button type="button" onClick={props.onClose}>
          Close
        </button>
      </DialogActions>
    </Dialog>
  );
}

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 10,
  paddingBottom: 6,
};
const chipStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
};
const searchStyle: React.CSSProperties = { flex: 1, minWidth: 160 };
const countStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
