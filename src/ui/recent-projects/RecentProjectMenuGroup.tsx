// The recent projects at the foot of the File menu (ADR-378), where
// LightBurn's File > Recent Projects list is. One click reopens a project;
// File > Recent Projects... manages the list.

import { useEffect } from 'react';
import { usePlatformOptional } from '../app/platform-context';
import { useToastStore } from '../state/toast-store';
import {
  MAX_RECENT_PROJECT_LIMIT,
  orderRecentProjects,
  recentProjectFolder,
  type RecentProjectEntry,
} from './recent-project-model';
import { reloadRecentProjects, useRecentProjectsStore } from './recent-projects-store';
import { openRecentProject } from './open-recent-project';

export function RecentProjectMenuGroup(props: { readonly onRun: () => void }): JSX.Element | null {
  const platform = usePlatformOptional();
  const entries = useRecentProjectsStore((state) => state.entries);
  const statuses = useRecentProjectsStore((state) => state.statuses);
  useEffect(() => {
    void reloadRecentProjects(platform?.recentFiles).catch(() => undefined);
  }, [platform]);
  if (platform === null || entries.length === 0) return null;
  const shown = orderRecentProjects(entries).slice(0, MAX_RECENT_PROJECT_LIMIT);
  const run = (event: React.MouseEvent<HTMLButtonElement>, entry: RecentProjectEntry): void => {
    // Like a command row: the dialog this may open returns focus to File.
    event.currentTarget.closest('details')?.querySelector('summary')?.focus();
    props.onRun();
    void openRecentProject(platform, entry, useToastStore.getState().pushToast);
  };
  return (
    <>
      <div role="separator" style={separatorStyle} />
      <div role="group" aria-label="Recent projects">
        <div style={groupLabelStyle}>Recent projects</div>
        {shown.map((entry) => {
          const missing = statuses[entry.id] === 'missing';
          return (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="lf-menu-item"
              title={entryTitle(entry, missing)}
              data-recent-project={entry.id}
              style={itemStyle}
              onClick={(event) => run(event, entry)}
            >
              <span style={nameStyle}>{entry.name}</span>
              {missing ? <span style={noteStyle}>missing</span> : null}
              {!missing && entry.pinned ? <span style={noteStyle}>pinned</span> : null}
            </button>
          );
        })}
      </div>
    </>
  );
}

function entryTitle(entry: RecentProjectEntry, missing: boolean): string {
  const folder = recentProjectFolder(entry);
  const where = folder === null ? '' : ` from ${folder}`;
  const state = missing ? ' The file was not found when last checked.' : '';
  return `Open ${entry.name}${where}.${state}`;
}

// The same chrome as the menu's command groups.
const separatorStyle: React.CSSProperties = {
  height: 1,
  flexShrink: 0,
  background: 'var(--lf-border)',
  margin: '3px 6px',
};
const groupLabelStyle: React.CSSProperties = {
  padding: '5px 9px 2px',
  color: 'var(--lf-text-faint)',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};
const itemStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  maxWidth: 360,
};
const nameStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'left',
};
const noteStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  fontSize: 12,
  whiteSpace: 'nowrap',
};
