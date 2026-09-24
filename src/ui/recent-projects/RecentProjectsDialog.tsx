// File > Recent Projects (ADR-378): the workstation's recent list, with pin,
// remove and clear, and how many unpinned projects to keep. A file that has
// gone missing stays listed and marked until the operator removes it.

import { useEffect } from 'react';
import type { PlatformAdapter } from '../../platform/types';
import { openProjectCommand } from '../commands/open-project-command';
import { Button, Dialog, DialogActions } from '../kit';
import { useToastStore } from '../state/toast-store';
import {
  canPinAnother,
  MAX_RECENT_PROJECT_LIMIT,
  orderRecentProjects,
  recentProjectFolder,
  type RecentProjectEntry,
} from './recent-project-model';
import {
  reloadRecentProjects,
  useRecentProjectsStore,
  type RecentProjectStatus,
  type RecentProjectsNotice,
} from './recent-projects-store';
import { openRecentProject } from './open-recent-project';
import { RecentProjectLimitField } from './RecentProjectLimitField';

export function RecentProjectsDialog(props: { readonly platform: PlatformAdapter }): JSX.Element {
  const entries = useRecentProjectsStore((state) => state.entries);
  const statuses = useRecentProjectsStore((state) => state.statuses);
  const notice = useRecentProjectsStore((state) => state.notice);
  const close = useRecentProjectsStore((state) => state.closeDialog);
  const { platform } = props;

  useEffect(() => {
    void reloadRecentProjects(platform.recentFiles).catch(() => undefined);
  }, [platform]);

  const pushToast = useToastStore.getState().pushToast;
  const openEntry = (entry: RecentProjectEntry): void => {
    close();
    void openRecentProject(platform, entry, pushToast);
  };
  const chooseFile = (): void => {
    close();
    void openProjectCommand(platform, pushToast);
  };
  const ordered = orderRecentProjects(entries);
  const canPin = canPinAnother(entries);
  return (
    <Dialog title="Recent Projects" size="lg" onClose={close}>
      {notice === null ? null : <NoticePanel notice={notice} onChooseFile={chooseFile} />}
      {ordered.length === 0 ? (
        <p style={emptyStyle}>
          No recent projects yet. Projects you open or save on this computer are listed here.
        </p>
      ) : (
        <ul style={listStyle} aria-label="Recent projects">
          {ordered.map((entry) => (
            <RecentProjectRow
              key={entry.id}
              entry={entry}
              status={statuses[entry.id]}
              canPin={canPin}
              onOpen={() => openEntry(entry)}
            />
          ))}
        </ul>
      )}
      <RecentProjectLimitField />
      <DialogActions>
        <ClearButtons entries={entries} />
        <Button variant="primary" onClick={close}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function NoticePanel(props: {
  readonly notice: RecentProjectsNotice;
  readonly onChooseFile: () => void;
}): JSX.Element {
  return (
    <div role="alert" style={noticeStyle}>
      <span>{props.notice.message}</span>
      {props.notice.offerPicker ? (
        <Button onClick={props.onChooseFile} title="Choose the project in the file picker">
          Choose file...
        </Button>
      ) : null}
    </div>
  );
}

function RecentProjectRow(props: {
  readonly entry: RecentProjectEntry;
  readonly status: RecentProjectStatus | undefined;
  readonly canPin: boolean;
  readonly onOpen: () => void;
}): JSX.Element {
  const { entry } = props;
  const folder = recentProjectFolder(entry);
  const store = useRecentProjectsStore.getState();
  return (
    <li style={rowStyle} data-recent-project={entry.id}>
      <div style={rowTextStyle}>
        <div style={nameLineStyle}>
          <span style={nameStyle}>{entry.name}</span>
          {entry.pinned ? <span style={tagStyle}>Pinned</span> : null}
          {props.status === 'missing' ? <span style={missingTagStyle}>Missing</span> : null}
        </div>
        {folder === null ? null : (
          <div style={detailStyle} title={folder}>
            {folder}
          </div>
        )}
        <div style={detailStyle}>
          {`Opened or saved ${formatUsedAt(entry.lastUsedAt)}`}
          {entry.ref === null ? ' · reopens through the file picker' : ''}
        </div>
      </div>
      <div style={rowActionsStyle}>
        <Button onClick={props.onOpen} title={`Open ${entry.name}`}>
          Open
        </Button>
        <Button
          disabled={!entry.pinned && !props.canPin}
          title={pinTitle(entry, props.canPin)}
          onClick={() => void store.setPinned(entry.id, !entry.pinned)}
        >
          {entry.pinned ? 'Unpin' : 'Pin'}
        </Button>
        <Button
          title={`Remove ${entry.name} from Recent Projects (the file itself is not touched)`}
          onClick={() => void store.remove(entry.id)}
        >
          Remove
        </Button>
      </div>
    </li>
  );
}

function ClearButtons(props: { readonly entries: ReadonlyArray<RecentProjectEntry> }): JSX.Element {
  const store = useRecentProjectsStore.getState();
  const hasUnpinned = props.entries.some((entry) => !entry.pinned);
  return (
    <>
      <Button
        disabled={!hasUnpinned}
        title="Remove every project that is not pinned from the list"
        onClick={() => void store.clearUnpinned()}
      >
        Clear unpinned
      </Button>
      <Button
        variant="danger"
        disabled={props.entries.length === 0}
        title="Remove every project from the list, pinned ones too (the files are not touched)"
        onClick={() => void store.clearAll()}
      >
        Clear all
      </Button>
    </>
  );
}

function pinTitle(entry: RecentProjectEntry, canPin: boolean): string {
  if (entry.pinned) return `Unpin ${entry.name}`;
  return canPin
    ? `Pin ${entry.name} to the top of the list`
    : `Up to ${MAX_RECENT_PROJECT_LIMIT} projects can be pinned`;
}

function formatUsedAt(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const emptyStyle: React.CSSProperties = { margin: '8px 0 12px', color: 'var(--lf-text-muted)' };
const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: '0 0 12px',
  padding: 0,
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  maxHeight: 360,
  overflow: 'auto',
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 8,
  padding: '8px 10px',
  borderBottom: '1px solid var(--lf-border-subtle)',
};
const rowTextStyle: React.CSSProperties = { display: 'grid', gap: 2, minWidth: 0, flex: 1 };
const nameLineStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const nameStyle: React.CSSProperties = {
  fontWeight: 700,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const tagStyle: React.CSSProperties = {
  padding: '0 6px',
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  fontSize: 11,
};
const missingTagStyle: React.CSSProperties = {
  ...tagStyle,
  borderColor: 'var(--lf-warning)',
  color: 'var(--lf-warning-fg)',
  background: 'var(--lf-tint-warning)',
};
const detailStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const rowActionsStyle: React.CSSProperties = { display: 'flex', gap: 6, flexShrink: 0 };
const noticeStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 8,
  marginBottom: 12,
  padding: '8px 10px',
  border: '1px solid var(--lf-warning)',
  borderRadius: 6,
  background: 'var(--lf-tint-warning)',
  color: 'var(--lf-warning-fg)',
};
