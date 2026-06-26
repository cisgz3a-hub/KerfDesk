// The Saved Libraries page (ADR-093, F-ML3): browse, open, rename, duplicate,
// delete, export, and import in-app material libraries. Reuses the Phase 1
// management actions and the existing .lfml file actions for Export/Import.

import type { MaterialLibraryDocument } from '../../io/material-library';
import {
  handleOpenMaterialLibrary,
  handleSaveMaterialLibrary,
} from '../app/material-library-file-actions';
import { usePlatform } from '../app/platform-context';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import {
  libraryDocument,
  type MaterialLibraryCollection,
  type SavedLibrarySummary,
} from '../state/material-library-collection';
import { useToastStore } from '../state/toast-store';
import { SavedLibraryRow } from './SavedLibraryRow';

// Exporting an inactive library must not flip the active library's saved marker.
const noopMarkSaved = (): void => undefined;

export function SavedLibrariesDialog(props: { readonly onClose: () => void }): JSX.Element {
  const platform = usePlatform();
  const device = useStore((state) => state.project.device);
  const savedLibraries = useStore((state) => state.savedLibraries);
  const materialLibrary = useStore((state) => state.materialLibrary);
  const createLibrary = useStore((state) => state.createLibrary);
  const openSavedLibrary = useStore((state) => state.openSavedLibrary);
  const renameLibrary = useStore((state) => state.renameLibrary);
  const duplicateLibrary = useStore((state) => state.duplicateLibrary);
  const deleteLibrary = useStore((state) => state.deleteLibrary);
  const setMaterialLibrary = useStore((state) => state.setMaterialLibrary);
  const markMaterialLibrarySaved = useStore((state) => state.markMaterialLibrarySaved);
  const listSavedLibraries = useStore((state) => state.listSavedLibraries);
  const pushToast = useToastStore((state) => state.pushToast);
  const summaries = listSavedLibraries();

  const exportLibrary = (summary: SavedLibrarySummary): void => {
    const doc = resolveDocument(summary, savedLibraries, materialLibrary);
    if (doc === null) return;
    void handleSaveMaterialLibrary({
      platform,
      library: doc,
      markMaterialLibrarySaved: summary.isActive ? markMaterialLibrarySaved : noopMarkSaved,
      pushToast,
    });
  };

  return (
    <Dialog onClose={props.onClose} title="Saved Libraries" size="lg">
      <div style={toolbarStyle}>
        <Button
          variant="primary"
          aria-label="New library"
          title="Create a new, empty material library."
          onClick={() => createLibrary(`${device.name} Library`)}
        >
          New library
        </Button>
        <Button
          aria-label="Import library"
          title="Import a material library from a file."
          onClick={() => {
            void handleOpenMaterialLibrary({ platform, setMaterialLibrary, pushToast });
          }}
        >
          Import...
        </Button>
      </div>
      {summaries.length === 0 ? (
        <p style={emptyStyle}>No saved libraries yet. Create one or import a file.</p>
      ) : (
        <ul style={listStyle}>
          {summaries.map((summary) => (
            <SavedLibraryRow
              key={summary.id}
              summary={summary}
              onOpen={() => {
                if (openSavedLibrary(summary.id)) props.onClose();
              }}
              onRename={(name) => renameLibrary(summary.id, name)}
              onDuplicate={() => duplicateLibrary(summary.id)}
              onDelete={() => {
                if (jobAwareConfirm(`Delete library "${summary.name}"?`)) deleteLibrary(summary.id);
              }}
              onExport={() => exportLibrary(summary)}
            />
          ))}
        </ul>
      )}
      <DialogActions>
        <Button onClick={props.onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function resolveDocument(
  summary: SavedLibrarySummary,
  savedLibraries: MaterialLibraryCollection,
  materialLibrary: MaterialLibraryDocument | null,
): MaterialLibraryDocument | null {
  if (summary.isActive && materialLibrary !== null) return materialLibrary;
  return libraryDocument(savedLibraries, summary.id);
}

const toolbarStyle: React.CSSProperties = { display: 'flex', gap: 8, marginBottom: 8 };
const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  maxHeight: 360,
  overflowY: 'auto',
};
const emptyStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontStyle: 'italic' };
