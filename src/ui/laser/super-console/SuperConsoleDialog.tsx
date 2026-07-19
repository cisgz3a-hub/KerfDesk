import { useMemo, useState } from 'react';
import { Dialog, DialogActions } from '../../kit/Dialog';
import { useLaserStore } from '../../state/laser-store';
import type { SerialTranscriptEntry } from '../../state/laser-transcript';
import { ConsoleCommandDeck } from '../console/ConsoleCommandDeck';
import {
  SUPER_CONSOLE_GROUPS,
  filterSuperConsoleEntries,
  formatSuperConsoleTsv,
  type SuperConsoleGroup,
} from './super-console-filters';
import { SuperConsoleSettingsPane } from './SuperConsoleSettingsPane';
import { SuperConsoleTranscriptList } from './SuperConsoleTranscriptList';

const ALL_GROUPS: ReadonlySet<SuperConsoleGroup> = new Set(
  SUPER_CONSOLE_GROUPS.map((group) => group.id),
);
type CopyState = 'idle' | 'copied' | 'manual';

export function SuperConsoleDialog(props: { readonly onClose: () => void }): JSX.Element {
  const transcript = useLaserStore((state) => state.transcript);
  const view = useSuperConsoleView(transcript);
  return (
    <Dialog
      onClose={props.onClose}
      title="Super console"
      size="xl"
      panelClassName="lf-dialog--super-console"
    >
      <SuperConsoleToolbar view={view} transcriptCount={transcript.length} />
      <div className="lf-super-console-body">
        <div className="lf-super-console-transcript" style={transcriptColumnStyle}>
          <SuperConsoleTranscriptList entries={view.visible} followLatest={view.followLatest} />
        </div>
        <SuperConsoleSettingsPane />
      </div>
      <div style={commandDeckStyle}>
        <div style={commandHeadingStyle}>
          <strong>Controller command</strong>
          <span style={countStyle}>
            Uses the same confirmation and machine-state gates as the docked console.
          </span>
        </div>
        <ConsoleCommandDeck ariaLabel="Super console commands" enableHistory />
      </div>
      <ManualCopyFallback visible={view.visible} copyState={view.copyState} />
      <SuperConsoleActions
        visibleCount={view.visible.length}
        copyState={view.copyState}
        onCopy={view.copyVisible}
        onClose={props.onClose}
      />
    </Dialog>
  );
}

function useSuperConsoleView(transcript: ReadonlyArray<SerialTranscriptEntry>) {
  const [groups, setGroups] = useState<ReadonlySet<SuperConsoleGroup>>(ALL_GROUPS);
  const [search, setSearch] = useState('');
  const [followLatest, setFollowLatest] = useState(true);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const visible = useMemo(
    () => filterSuperConsoleEntries(transcript, { groups, search }),
    [transcript, groups, search],
  );
  const toggleGroup = (id: SuperConsoleGroup): void => {
    setGroups((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setCopyState('idle');
  };
  const copyVisible = (): void => {
    const text = formatSuperConsoleTsv(visible);
    if (navigator.clipboard?.writeText === undefined) return setCopyState('manual');
    void navigator.clipboard.writeText(text).then(
      () => setCopyState('copied'),
      () => setCopyState('manual'),
    );
  };
  return {
    groups,
    search,
    followLatest,
    copyState,
    visible,
    toggleGroup,
    copyVisible,
    setFollowLatest,
    setSearch: (value: string) => {
      setSearch(value);
      setCopyState('idle');
    },
  };
}

type SuperConsoleView = ReturnType<typeof useSuperConsoleView>;

function SuperConsoleToolbar(props: {
  readonly view: SuperConsoleView;
  readonly transcriptCount: number;
}): JSX.Element {
  return (
    <div style={toolbarStyle}>
      {SUPER_CONSOLE_GROUPS.map((group) => (
        <label key={group.id} title={group.hint} style={chipStyle}>
          <input
            type="checkbox"
            title={group.hint}
            checked={props.view.groups.has(group.id)}
            onChange={() => props.view.toggleGroup(group.id)}
          />
          {group.label}
        </label>
      ))}
      <input
        aria-label="Search console lines"
        title="Filter by timestamp, direction, source, kind, raw text, or meaning."
        placeholder="Search any transcript column..."
        value={props.view.search}
        onChange={(event) => props.view.setSearch(event.target.value)}
        style={searchStyle}
      />
      <span style={countStyle}>
        {props.view.visible.length} of {props.transcriptCount} lines
      </span>
      <label style={chipStyle} title="Keep the transcript scrolled to the newest visible line.">
        <input
          type="checkbox"
          checked={props.view.followLatest}
          onChange={(event) => props.view.setFollowLatest(event.target.checked)}
        />
        Follow latest
      </label>
    </div>
  );
}

function ManualCopyFallback(props: {
  readonly visible: ReadonlyArray<SerialTranscriptEntry>;
  readonly copyState: CopyState;
}): JSX.Element | null {
  if (props.copyState !== 'manual') return null;
  return (
    <label style={manualCopyStyle}>
      Clipboard access failed. Select and copy this transcript manually.
      <textarea
        readOnly
        aria-label="Super console transcript to copy manually"
        value={formatSuperConsoleTsv(props.visible)}
        onFocus={(event) => event.currentTarget.select()}
        style={manualCopyTextStyle}
      />
    </label>
  );
}

function SuperConsoleActions(props: {
  readonly visibleCount: number;
  readonly copyState: CopyState;
  readonly onCopy: () => void;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <DialogActions>
      <button
        type="button"
        title="Copy the filtered transcript as timestamped tab-separated values."
        onClick={props.onCopy}
        disabled={props.visibleCount === 0}
      >
        {props.copyState === 'copied' ? 'Copied' : 'Copy visible'}
      </button>
      <button
        type="button"
        title="Close the expanded Super console and return to the workspace."
        onClick={props.onClose}
      >
        Close
      </button>
    </DialogActions>
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
const transcriptColumnStyle: React.CSSProperties = { display: 'flex' };
const countStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
const commandDeckStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  background: 'var(--lf-bg-input)',
  padding: 7,
};
const commandHeadingStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  flexWrap: 'wrap',
  marginBottom: 5,
};
const manualCopyStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
const manualCopyTextStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 72,
  boxSizing: 'border-box',
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 11,
};
