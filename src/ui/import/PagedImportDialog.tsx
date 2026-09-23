import { useCallback, useEffect, useRef, useState } from 'react';
import type { SceneObject } from '../../core/scene';
import { Button, Dialog, DialogActions, Field, NumberInput } from '../kit';
import { useStore } from '../state';
import { pageArtworkObject } from './page-artwork-object';
import type { PreparedArtworkPage } from './paged-artwork-source';
import { usePagedImportStore, type PagedImportRequest } from './paged-import-store';

export function PagedImportDialog(): JSX.Element | null {
  const request = usePagedImportStore((state) => state.request);
  const generation = usePagedImportStore((state) => state.generation);
  return request === null ? null : <ImportPage key={generation} request={request} />;
}

function usePageImport(request: PagedImportRequest) {
  const finish = usePagedImportStore((state) => state.finish);
  const project = useStore((state) => state.project);
  const [pageNumber, setPageNumber] = useState('1');
  const [dpi, setDpi] = useState('300');
  const [mode, setMode] = useState<'paths' | 'image'>('paths');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activeImport = useRef<AbortController | null>(null);
  const prepared = usePreparedPage(request, Number(pageNumber));
  const page = prepared.page;
  const actualMode = page?.vectorSvg === null ? 'image' : mode;
  const cancel = useCallback(() => {
    activeImport.current?.abort();
    finish(request, null);
  }, [finish, request]);
  useEffect(() => () => activeImport.current?.abort(), []);
  useEffect(() => {
    if (!request.isCurrent()) cancel();
  }, [request, cancel, project]);
  const importPage = async (): Promise<void> => {
    if (page === null || busy) return;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    activeImport.current = controller;
    try {
      await pageArtworkObject(
        page,
        request.source.name + ' — page ' + pageNumber,
        actualMode,
        Number(dpi),
        { signal: controller.signal, commit: commitPage(request, finish) },
      );
    } catch (failure) {
      if (controller.signal.aborted || usePagedImportStore.getState().request !== request) return;
      setError(errorText(failure));
      setBusy(false);
    }
  };
  return {
    cancel,
    pageNumber,
    setPageNumber,
    dpi,
    setDpi,
    setMode,
    setError,
    error,
    busy,
    prepared,
    page,
    actualMode,
    importPage,
  };
}

function ImportPage({ request }: { readonly request: PagedImportRequest }): JSX.Element {
  const {
    cancel,
    pageNumber,
    setPageNumber,
    dpi,
    setDpi,
    setMode,
    setError,
    error,
    busy,
    prepared,
    page,
    actualMode,
    importPage,
  } = usePageImport(request);
  return (
    <Dialog title="Import document page" size="md" onClose={cancel}>
      <div style={{ display: 'grid', gap: 12 }}>
        <p>
          {request.source.name} · {request.source.pageCount} page(s)
        </p>
        <Field label="Page">
          <NumberInput
            aria-label="Page to import"
            title="Choose which document page to add to the current project."
            min={1}
            max={request.source.pageCount}
            step={1}
            value={pageNumber}
            disabled={busy}
            onChange={(event) => {
              setPageNumber(event.target.value);
              setError(null);
            }}
          />
        </Field>
        {page === null ? (
          <p role="status">{prepared.valid ? 'Preparing page…' : 'Choose an available page.'}</p>
        ) : (
          <PagePreview
            page={page}
            number={pageNumber}
            mode={actualMode}
            setMode={setMode}
            dpi={dpi}
            setDpi={setDpi}
            busy={busy}
          />
        )}
        {error !== null || prepared.error !== null ? (
          <p role="alert">{error ?? prepared.error}</p>
        ) : null}
      </div>
      <DialogActions>
        <Button title="Close this page import without adding artwork." onClick={cancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          title="Add the selected page using the chosen import mode."
          disabled={page === null || busy}
          onClick={() => {
            void importPage();
          }}
        >
          {busy ? 'Importing…' : 'Import page'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function commitPage(
  request: PagedImportRequest,
  finish: (request: PagedImportRequest, object: SceneObject | null) => void,
): (object: SceneObject) => void {
  return (object) => {
    if (usePagedImportStore.getState().request !== request || !request.isCurrent()) {
      throw new DOMException('Document page import cancelled.', 'AbortError');
    }
    request.commit(object);
    finish(request, object);
  };
}

function usePreparedPage(request: PagedImportRequest, number: number) {
  const [loaded, setLoaded] = useState<{
    request: PagedImportRequest;
    number: number;
    page: PreparedArtworkPage | null;
    error: string | null;
  } | null>(null);
  const valid = Number.isInteger(number) && number >= 1 && number <= request.source.pageCount;
  useEffect(() => {
    let active = true;
    if (valid) {
      void request.source
        .prepare(number)
        .then((page) => {
          if (active) setLoaded({ request, number, page, error: null });
        })
        .catch((failure: unknown) => {
          if (active) setLoaded({ request, number, page: null, error: errorText(failure) });
        });
    }
    return () => {
      active = false;
    };
  }, [request, number, valid]);
  const current = loaded?.request === request && loaded.number === number;
  return { valid, page: current ? loaded.page : null, error: current ? loaded.error : null };
}

type PagePreviewProps = {
  readonly page: PreparedArtworkPage;
  readonly number: string;
  readonly mode: 'paths' | 'image';
  readonly setMode: (mode: 'paths' | 'image') => void;
  readonly dpi: string;
  readonly setDpi: (dpi: string) => void;
  readonly busy: boolean;
};

function PagePreview({
  page,
  number,
  mode,
  setMode,
  dpi,
  setDpi,
  busy,
}: PagePreviewProps): JSX.Element {
  return (
    <>
      <img
        src={page.thumbnail}
        alt={'Preview of page ' + number}
        style={{ maxWidth: '100%', maxHeight: 220, objectFit: 'contain', background: 'white' }}
      />
      <p>
        {page.widthMm.toFixed(2)} × {page.heightMm.toFixed(2)} mm
      </p>
      <Field label="Import as">
        <select
          className="lf-input"
          aria-label="Page import mode"
          title="Choose editable paths or an image of the complete page."
          value={mode}
          disabled={busy}
          onChange={(event) => setMode(event.target.value === 'paths' ? 'paths' : 'image')}
        >
          {page.vectorSvg !== null ? <option value="paths">Editable paths</option> : null}
          <option value="image">Image for engraving or tracing</option>
        </select>
      </Field>
      <p>{page.note}</p>
      {mode === 'image' ? (
        <p>The source image is preserved; the working engraving preview may be sampled.</p>
      ) : null}
      {mode === 'image' && page.resolutionEditable ? (
        <Field label="Resolution" unit="DPI">
          <NumberInput
            aria-label="Page image resolution"
            title="Set image detail in dots per inch; the page keeps its physical size."
            min={1}
            value={dpi}
            disabled={busy}
            onChange={(event) => setDpi(event.target.value)}
          />
        </Field>
      ) : null}
    </>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
