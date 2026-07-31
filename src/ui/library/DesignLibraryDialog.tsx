// DesignLibraryDialog - accessible browsing and inspected insertion for the
// bundled manufacturing templates and vetted artwork. Insertion stays on the
// normal SVG scene path and never applies operation or machine settings.

import { useMemo, useState } from 'react';
import { Dialog, IconButton } from '../kit';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { CollectionRail, LibraryToolbar, type UpdateLibraryFilter } from './DesignLibraryControls';
import { DesignLibraryDetails } from './DesignLibraryDetails';
import { DesignLibraryGrid } from './DesignLibraryGrid';
import { DESIGN_LIBRARY } from './design-library';
import { filterDesignLibrary, type LibraryFilters } from './design-library-filter';
import type { LibraryEntry } from './design-library-types';
import { EMPTY_LIBRARY_FILTERS } from './design-library-view-model';
import { librarySvgObjectFor } from './library-entry-insert';
import './design-library.css';
import './design-library-card.css';
import './design-library-detail.css';

const INITIAL_LIBRARY_ENTRY_ID =
  filterDesignLibrary(DESIGN_LIBRARY, EMPTY_LIBRARY_FILTERS)[0]?.id ?? '';

export function DesignLibraryDialog(): JSX.Element | null {
  const open = useUiStore((state) => state.libraryDialogOpen);
  return open ? <OpenDesignLibraryDialog /> : null;
}

function OpenDesignLibraryDialog(): JSX.Element {
  const setOpen = useUiStore((state) => state.setLibraryDialogOpen);
  const close = (): void => setOpen(false);
  const browser = useDesignLibraryBrowser(close);
  return (
    <Dialog title="Design Library" size="xl" panelClassName="lf-library-dialog" onClose={close}>
      <div className="lf-library-dialog__close">
        <IconButton icon="close" label="Close Design Library" onClick={close} size="sm" />
      </div>
      <p className="lf-library-dialog__intro">
        Explore editable vectors, inspect exact licensing, then add one design to your canvas.
      </p>
      <div className="lf-library-shell">
        <LibraryToolbar
          entries={DESIGN_LIBRARY}
          filters={browser.filters}
          filtersOpen={browser.filtersOpen}
          updateFilter={browser.updateFilter}
          setFiltersOpen={browser.setFiltersOpen}
          clearFilters={browser.clearFilters}
        />
        <LibraryWorkspace browser={browser} />
      </div>
    </Dialog>
  );
}

type LibraryBrowser = ReturnType<typeof useDesignLibraryBrowser>;

function LibraryWorkspace(props: { readonly browser: LibraryBrowser }): JSX.Element {
  const browser = props.browser;
  return (
    <div className="lf-library-workspace">
      <CollectionRail
        entries={DESIGN_LIBRARY}
        filters={browser.filters}
        updateFilter={browser.updateFilter}
      />
      <section className="lf-library-results" aria-label="Design Library results">
        <div className="lf-library-results__summary">
          <span role="status" aria-live="polite" aria-atomic="true">
            {resultCountLabel(browser.visibleEntries.length, DESIGN_LIBRARY.length)}
          </span>
          <span>Choose a card to inspect it</span>
        </div>
        <DesignLibraryGrid
          entries={browser.visibleEntries}
          selectedId={browser.selectedEntry?.id}
          addingId={browser.addingId}
          onSelect={browser.selectEntry}
          onAdd={browser.insertOne}
          clearFilters={browser.clearFilters}
        />
      </section>
      <DesignLibraryDetails
        entry={browser.selectedEntry}
        errorMessage={browser.errorMessage}
        addingId={browser.addingId}
        onAdd={browser.insertOne}
        onReturnToResults={returnToNarrowCard}
      />
    </div>
  );
}

function useDesignLibraryBrowser(onClose: () => void) {
  const importSvgObject = useStore((state) => state.importSvgObject);
  const pushToast = useToastStore((state) => state.pushToast);
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_LIBRARY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(INITIAL_LIBRARY_ENTRY_ID);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [addingId, setAddingId] = useState<string>();
  const visibleEntries = useMemo(() => filterDesignLibrary(DESIGN_LIBRARY, filters), [filters]);
  const selectedEntry =
    visibleEntries.find((entry) => entry.id === selectedId) ?? visibleEntries[0];

  const reportInsertError = (entry: LibraryEntry): void => {
    const message = `${entry.title} could not be added. The Library is still open so you can try another design.`;
    setErrorMessage(message);
    pushToast(`Could not add ${entry.title}.`, 'error');
  };
  const applyFilters = (nextFilters: LibraryFilters): void => {
    const nextEntries = filterDesignLibrary(DESIGN_LIBRARY, nextFilters);
    setFilters(nextFilters);
    setSelectedId((current) =>
      nextEntries.some((entry) => entry.id === current) ? current : (nextEntries[0]?.id ?? ''),
    );
    setErrorMessage(undefined);
  };
  const insertEntry = async (entry: LibraryEntry): Promise<void> => {
    let added = false;
    setAddingId(entry.id);
    setErrorMessage(undefined);
    try {
      const object = await librarySvgObjectFor(entry, crypto.randomUUID());
      if (object === null) {
        reportInsertError(entry);
        return;
      }
      const outcome = importSvgObject(object);
      if (outcome.kind !== 'added') {
        reportInsertError(entry);
        return;
      }
      added = true;
    } catch {
      reportInsertError(entry);
    } finally {
      setAddingId(undefined);
    }
    if (added) {
      pushToast(`${entry.title} added to the canvas.`, 'success');
      onClose();
    }
  };
  const insertOne = (entry: LibraryEntry): void => {
    if (addingId !== undefined) return;
    void insertEntry(entry);
  };
  const updateFilter: UpdateLibraryFilter = (key, value): void => {
    applyFilters({ ...filters, [key]: value });
  };
  const clearFilters = (): void => {
    applyFilters(EMPTY_LIBRARY_FILTERS);
  };

  return {
    filters,
    filtersOpen,
    visibleEntries,
    selectedEntry,
    errorMessage,
    addingId,
    updateFilter,
    setFiltersOpen,
    clearFilters,
    insertOne,
    selectEntry: (entry: LibraryEntry): void => {
      setSelectedId(entry.id);
      setErrorMessage(undefined);
      revealNarrowDetails();
    },
  };
}

function revealNarrowDetails(): void {
  if (typeof window.matchMedia !== 'function') return;
  if (!window.matchMedia('(max-width: 920px)').matches) return;
  window.requestAnimationFrame(() => {
    const detail = document.getElementById('library-detail-panel');
    detail?.focus({ preventScroll: true });
    detail?.scrollIntoView({ block: 'start' });
  });
}

function returnToNarrowCard(entry: LibraryEntry): void {
  const card = document.getElementById(`library-card-${entry.id}`);
  card?.focus({ preventScroll: true });
  card?.scrollIntoView({ block: 'center' });
}

function resultCountLabel(visible: number, total: number): string {
  if (visible === total) return `${total} designs`;
  return `${visible} of ${total} designs`;
}
