// File > Recover unsaved work (ADR-688): the autosaves of earlier sessions
// that were never saved as a file. Starting new work never removes one, so a
// design the startup card was not used for stays reachable here until it is
// restored, or discarded with Don't Save after it has been restored.

import { useEffect, useMemo, useState } from 'react';
import type { PlatformAdapter } from '../../platform/types';
import { Button, Dialog, DialogActions } from '../kit';
import { projectAutosaveService, type AutosaveDurableSnapshot } from '../state/autosave-durable';
import { useToastStore } from '../state/toast-store';
import { usePlatformOptional } from './platform-context';
import { recoveryObjectSummary, recoveryThumbnail } from './autosave-recovery-summary';
import { restoreUnsavedWork } from './restore-unsaved-work';
import { recoveryAgeLabel } from './use-autosave';
import { useUnsavedWorkStore } from './unsaved-work-store';

export const UNSAVED_WORK_LIST_LIMIT = 10;

type UnsavedWorkSource = Pick<typeof projectAutosaveService, 'readRecent'>;

type ListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly snapshots: ReadonlyArray<AutosaveDurableSnapshot> }
  | { readonly kind: 'failed' };

export function UnsavedWorkHost(): JSX.Element | null {
  const platform = usePlatformOptional();
  const open = useUnsavedWorkStore((state) => state.open);
  if (platform === null || !open) return null;
  return <UnsavedWorkDialog platform={platform} />;
}

export function UnsavedWorkDialog(props: {
  readonly platform: PlatformAdapter;
  readonly source?: UnsavedWorkSource;
}): JSX.Element {
  const close = useUnsavedWorkStore((state) => state.closeDialog);
  const source = props.source ?? projectAutosaveService;
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  useEffect(() => {
    let current = true;
    source.readRecent().then(
      (snapshots) => {
        if (current) setList({ kind: 'ready', snapshots });
      },
      () => {
        if (current) setList({ kind: 'failed' });
      },
    );
    return () => {
      current = false;
    };
  }, [source]);
  const restore = (snapshot: AutosaveDurableSnapshot): void => {
    close();
    void restoreUnsavedWork(props.platform, snapshot, useToastStore.getState().pushToast);
  };
  const where = props.platform.id === 'electron' ? 'on this computer' : 'in this browser';
  return (
    <Dialog title="Recover unsaved work" size="md" onClose={close}>
      <p style={introStyle}>
        Work from earlier sessions that was never saved as a file, kept {where}. Restoring one
        replaces the open project; you are asked to save it first.
      </p>
      <UnsavedWorkList list={list} onRestore={restore} />
      <DialogActions>
        <Button variant="primary" onClick={close}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function UnsavedWorkList(props: {
  readonly list: ListState;
  readonly onRestore: (snapshot: AutosaveDurableSnapshot) => void;
}): JSX.Element {
  const { list } = props;
  if (list.kind === 'loading') return <p style={emptyStyle}>Looking for unsaved work…</p>;
  if (list.kind === 'failed') {
    return (
      <p role="alert" style={emptyStyle}>
        Autosave storage could not be read. Any work it holds is left unchanged.
      </p>
    );
  }
  if (list.snapshots.length === 0) {
    return <p style={emptyStyle}>No unsaved work from earlier sessions.</p>;
  }
  return (
    <ul style={listStyle} aria-label="Unsaved work from earlier sessions">
      {list.snapshots.slice(0, UNSAVED_WORK_LIST_LIMIT).map((snapshot) => (
        <UnsavedWorkRow
          // readRecent lists each session's slot once (ADR-688 Amendment 1).
          key={snapshot.storageKey}
          snapshot={snapshot}
          onRestore={() => props.onRestore(snapshot)}
        />
      ))}
    </ul>
  );
}

function UnsavedWorkRow(props: {
  readonly snapshot: AutosaveDurableSnapshot;
  readonly onRestore: () => void;
}): JSX.Element {
  const { snapshot } = props;
  const thumbnail = useMemo(() => recoveryThumbnail(snapshot.project), [snapshot.project]);
  const savedAt = new Date(snapshot.savedAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <li style={rowStyle} data-unsaved-work={snapshot.storageKey}>
      {thumbnail === null ? (
        <span style={thumbnailStyle} aria-hidden="true" />
      ) : (
        <img style={thumbnailStyle} src={thumbnail} alt="" />
      )}
      <div style={rowTextStyle}>
        <span style={nameStyle}>{recoveryObjectSummary(snapshot.project)}</span>
        <span style={detailStyle}>
          Autosaved {savedAt} ({recoveryAgeLabel(snapshot.savedAt)})
        </span>
      </div>
      <Button onClick={props.onRestore} title="Open this work as the current project">
        Restore
      </Button>
    </li>
  );
}

const introStyle: React.CSSProperties = {
  margin: '0 0 10px',
  color: 'var(--lf-text-muted)',
  lineHeight: 1.45,
};
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
  gap: 10,
  padding: '8px 10px',
  borderBottom: '1px solid var(--lf-border-subtle)',
};
// Artwork keeps its operation colours, so it sits on a light swatch in both themes.
const thumbnailStyle: React.CSSProperties = {
  flex: 'none',
  width: 48,
  height: 48,
  boxSizing: 'border-box',
  padding: 4,
  objectFit: 'contain',
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  background: 'var(--lf-burn-preview-material)',
};
const rowTextStyle: React.CSSProperties = { display: 'grid', gap: 2, minWidth: 0, flex: 1 };
const nameStyle: React.CSSProperties = { fontWeight: 700 };
const detailStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
