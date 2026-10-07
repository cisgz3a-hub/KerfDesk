import { useEffect, useState } from 'react';
import type { PlatformAdapter } from '../../platform/types';
import { Button } from '../kit';
import { useStore } from '../state';
import { projectWithCurrentJobSetup } from '../state/project-job-setup';
import { useToastStore } from '../state/toast-store';
import {
  captureLocalProjectSnapshot,
  MAX_LOCAL_SNAPSHOTS,
  type LocalProjectSnapshotHeader,
} from './local-project-snapshot';
import { localSnapshotStorage, type LocalSnapshotStorage } from './local-snapshot-storage';
import { restoreLocalSnapshot } from './restore-local-snapshot';

export function LocalProjectSnapshots(props: {
  readonly platform: PlatformAdapter;
  readonly onRestored: () => void;
  readonly storage?: LocalSnapshotStorage;
}): JSX.Element {
  const storage = props.storage ?? localSnapshotStorage();
  const view = useSnapshots(storage);
  return (
    <details open style={panelStyle}>
      <summary
        style={{ fontWeight: 700 }}
        title="Manage named project copies on this computer and draft operator notes separately from autosave."
      >
        Local snapshots and operator notes
      </summary>
      <p style={hintStyle}>
        Name a complete copy before trying another layout or process. Restore opens a new project;
        Save asks for a destination. These copies stay on this computer and are separate from
        autosave. Browser storage can be cleared; keep a saved project file for a lasting backup.
      </p>
      <SnapshotCapture view={view} />
      <CurrentProjectNotes />
      {view.error === null ? null : <p role="alert">{view.error}</p>}
      <SnapshotList
        entries={view.entries}
        busy={view.busy}
        onRestore={(id) =>
          void view.run(async () => {
            if (
              await restoreLocalSnapshot(
                props.platform,
                storage,
                id,
                useToastStore.getState().pushToast,
              )
            )
              props.onRestored();
          })
        }
        onRemove={(id) =>
          void view.run(async () => {
            await storage.remove(id);
            await view.reload();
          })
        }
      />
      <p style={hintStyle}>
        Up to 12 copies, 128 MiB each and 256 MiB total. A full list never removes older copies
        automatically.
      </p>
    </details>
  );
}

function useSnapshots(storage: LocalSnapshotStorage) {
  const [entries, setEntries] = useState<ReadonlyArray<LocalProjectSnapshotHeader>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = async (): Promise<void> => {
    setEntries(await storage.list());
  };
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Local snapshot storage failed.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let current = true;
    void storage
      .list()
      .then((list) => {
        if (current) setEntries(list);
      })
      .catch(() => {
        if (current)
          setError('Local snapshot storage is unavailable. Save a project file to keep your work.');
      });
    return () => {
      current = false;
    };
  }, [storage]);
  return { entries, busy, error, reload, run, storage };
}

function SnapshotCapture(props: { readonly view: ReturnType<typeof useSnapshots> }): JSX.Element {
  const savedName = useStore((state) => state.savedName);
  const [name, setName] = useState('');
  const { view } = props;
  const capture = (): void => {
    const project = projectWithCurrentJobSetup(useStore.getState());
    void view.run(async () => {
      await view.storage.add(await captureLocalProjectSnapshot(project, name));
      await view.reload();
      setName('');
      useToastStore.getState().pushToast('Saved a complete local snapshot.', 'success');
    });
  };
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <label>
        Snapshot name{' '}
        <input
          className="lf-input"
          aria-label="Local snapshot name"
          title="Name the complete local project copy to capture, such as the layout or process you want to preserve."
          maxLength={120}
          placeholder={savedName?.replace(/\.lf2$/i, '') ?? 'Before process changes'}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <Button
        disabled={view.busy || name.trim() === '' || view.entries.length >= MAX_LOCAL_SNAPSHOTS}
        onClick={capture}
      >
        {view.busy ? 'Working…' : 'Save local snapshot'}
      </Button>
    </div>
  );
}

function CurrentProjectNotes(): JSX.Element {
  const notes = useStore((state) => state.project.notes);
  const epoch = useStore((state) => state.projectDocumentEpoch);
  const [draft, setDraft] = useState(notes);
  useEffect(() => {
    setDraft(notes);
  }, [notes, epoch]);
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <label>
        Current project operator notes
        <textarea
          className="lf-input"
          aria-label="Current project operator notes"
          title="Draft material, setup and result notes, then choose Apply notes to store them in the project before taking a snapshot."
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder="Material, focus, result, next step…"
          style={{ width: '100%', resize: 'vertical' }}
        />
      </label>
      <div>
        <Button
          disabled={draft === notes}
          onClick={() => useStore.getState().setProjectNotes(draft)}
        >
          Apply notes
        </Button>
      </div>
      <p style={hintStyle}>
        Apply notes before taking a snapshot. Notes are part of the project and can be undone.
      </p>
    </div>
  );
}

function SnapshotList(props: {
  readonly entries: ReadonlyArray<LocalProjectSnapshotHeader>;
  readonly busy: boolean;
  readonly onRestore: (id: string) => void;
  readonly onRemove: (id: string) => void;
}): JSX.Element {
  if (props.entries.length === 0) return <p style={hintStyle}>No named local snapshots yet.</p>;
  return (
    <ul
      aria-label="Named local snapshots"
      style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 240, overflow: 'auto' }}
    >
      {props.entries.map((entry, index) => (
        <li key={entry.id} data-local-snapshot={entry.id} style={rowStyle}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong>{entry.name}</strong> {index === 0 ? <span>· Latest local copy</span> : null}
            <div style={hintStyle}>
              {new Date(entry.createdAt).toLocaleString()} · {(entry.bytes / 1048576).toFixed(2)}{' '}
              MiB
            </div>
            {entry.notesExcerpt === '' ? null : (
              <p style={{ ...hintStyle, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {entry.notesExcerpt}
              </p>
            )}
          </div>
          <Button
            disabled={props.busy}
            title="Open this copy as a new unsaved document"
            onClick={() => props.onRestore(entry.id)}
          >
            Resume as new project
          </Button>
          <Button
            disabled={props.busy}
            title="Delete this local copy; saved project files are untouched"
            onClick={() => props.onRemove(entry.id)}
          >
            Remove snapshot
          </Button>
        </li>
      ))}
    </ul>
  );
}

const hintStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  margin: '4px 0',
  lineHeight: 1.45,
};
const panelStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 10,
  marginBottom: 12,
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  padding: '8px 0',
  borderBottom: '1px solid var(--lf-border-subtle)',
};
