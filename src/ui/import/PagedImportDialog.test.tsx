import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PagedImportDialog } from './PagedImportDialog';
import { usePagedImportStore, type PagedImportRequest } from './paged-import-store';
import type { PreparedArtworkPage } from './paged-artwork-source';
import { parseSvgOffThread } from './document-import-worker-client';

vi.mock('./document-import-worker-client', () => ({ parseSvgOffThread: vi.fn() }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const page: PreparedArtworkPage = {
  widthMm: 50.8,
  heightMm: 25.4,
  thumbnail: 'data:image/png;base64,AA==',
  resolutionEditable: true,
  vectorSvg:
    '<svg xmlns="http://www.w3.org/2000/svg" width="50.8mm" height="25.4mm" viewBox="0 0 50.8 25.4"><path d="M1 2L10 2" stroke="red"/></svg>',
  note: 'Editable page',
  render: async () => document.createElement('canvas'),
};
beforeEach(async () => {
  vi.mocked(parseSvgOffThread).mockReset().mockReturnValue(null);
  usePagedImportStore.setState({ request: null });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<PagedImportDialog />);
  });
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  usePagedImportStore.setState({ request: null });
});

function request(prepare = vi.fn(async () => page)): PagedImportRequest {
  return {
    source: { name: 'pages.pdf', pageCount: 2, prepare, dispose: async () => undefined },
    isCurrent: () => true,
    commit: vi.fn(),
    resolve: vi.fn(),
  };
}
async function open(value: PagedImportRequest) {
  await act(async () => {
    usePagedImportStore.getState().open(value);
  });
}
async function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find(
    (item) => item.textContent === label,
  );
  expect(button).toBeDefined();
  await act(async () => {
    button?.click();
  });
}
async function setPage(value: string) {
  const input = document.querySelector<HTMLInputElement>('[aria-label="Page to import"]');
  if (input === null) throw new Error('Missing page input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('document page selection and ownership', () => {
  it('previews and imports editable paths with physical page bounds', async () => {
    const value = request();
    await open(value);
    expect(document.body.textContent).toContain('50.80 × 25.40 mm');
    await click('Import page');
    expect(value.commit).toHaveBeenCalledOnce();
    expect(value.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'imported-svg',
        bounds: { minX: 0, minY: 0, maxX: 50.8, maxY: 25.4 },
      }),
    );
  });

  it('ignores a stale page preview and never imports the previous page under a new number', async () => {
    let resolve!: (page: PreparedArtworkPage) => void;
    const promise = new Promise<PreparedArtworkPage>((complete) => {
      resolve = complete;
    });
    const prepare = vi.fn(async () => page).mockImplementationOnce(() => promise);
    const value = request(prepare);
    await open(value);
    await setPage('2');
    expect(prepare).toHaveBeenLastCalledWith(2);
    await act(async () => {
      resolve({ ...page, widthMm: 999 });
    });
    expect(document.body.textContent).not.toContain('999.00');
    await click('Import page');
    expect(value.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'pages.pdf — page 2' }),
    );
  });

  it('cancels without artwork, resets the next document to page one and blocks stale completion', async () => {
    const first = request();
    await open(first);
    await setPage('2');
    await click('Cancel');
    expect(first.resolve).toHaveBeenCalledWith(null);
    const second = request();
    await open(second);
    expect(document.querySelector<HTMLInputElement>('[aria-label="Page to import"]')?.value).toBe(
      '1',
    );
    await act(async () => {
      usePagedImportStore.getState().finish(first, null);
    });
    expect(usePagedImportStore.getState().request).toBe(second);
    await click('Cancel');
  });

  it('shows a truthful render-only fallback and keeps original TIFF resolution fixed', async () => {
    await open(
      request(
        vi.fn(async () => ({
          ...page,
          vectorSvg: null,
          resolutionEditable: false,
          note: 'Original pixel grid preserved.',
        })),
      ),
    );
    expect(document.querySelector('option[value="paths"]')).toBeNull();
    expect(document.querySelector('[aria-label="Page image resolution"]')).toBeNull();
    expect(document.body.textContent).toContain('Original pixel grid preserved.');
  });

  it('cancels the active SVG worker when the page dialog closes', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(parseSvgOffThread).mockImplementation((_blob, _id, _source, options) => {
      signal = options?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => reject(new DOMException('cancelled', 'AbortError')),
          { once: true },
        );
      });
    });
    const value = request();
    await open(value);
    await click('Import page');
    expect(signal?.aborted).toBe(false);
    await click('Cancel');
    expect(signal?.aborted).toBe(true);
    expect(value.resolve).toHaveBeenCalledExactlyOnceWith(null);
    expect(usePagedImportStore.getState().request).toBeNull();
  });

  it('commits before resolving the dialog and preserves the request when insertion fails', async () => {
    const value = request();
    vi.mocked(value.commit).mockImplementation(() => {
      expect(value.resolve).not.toHaveBeenCalled();
      throw new Error('Insertion failed');
    });
    await open(value);
    await click('Import page');
    expect(value.commit).toHaveBeenCalledOnce();
    expect(value.resolve).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Insertion failed');
    expect(usePagedImportStore.getState().request).toBe(value);
    await click('Cancel');
  });
});
