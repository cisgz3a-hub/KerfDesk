import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { DEFAULT_EXPORT_PRECISION_MM } from '../../core/vector-export/decimal-grid';
import { chooseImagesAndTrace, chosenImageHandle } from './multi-file-trace-dialog.test-helpers';
import { PlatformProvider } from '../app/platform-context';
import { MultiFileTraceDialogHost } from './MultiFileTraceDialog';
import type * as multiFileTraceAction from './multi-file-trace-action';
import { runMultiFileTrace } from './multi-file-trace-action';

vi.mock('./multi-file-trace-action', async (importOriginal) => ({
  ...(await importOriginal<typeof multiFileTraceAction>()),
  runMultiFileTrace: vi.fn(async () => undefined),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.mocked(runMultiFileTrace).mockClear();
});

function mount(): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  const mounted = createRoot(host);
  root = mounted;
  act(() =>
    mounted.render(
      <PlatformProvider
        adapter={{ ...mockPlatform(), pickFilesForOpen: vi.fn(async () => [chosenImageHandle()]) }}
      >
        <MultiFileTraceDialogHost onClose={() => undefined} />
      </PlatformProvider>,
    ),
  );
}

function pageSelect(): HTMLSelectElement {
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="Page size"]');
  if (select === null) throw new Error('No page select.');
  return select;
}

function marginInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('input[aria-label="Page margin"]');
}

function typeInto(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submitAndReadOutput(): Promise<unknown> {
  await chooseImagesAndTrace();
  await act(async () => {
    await vi.waitFor(() => expect(runMultiFileTrace).toHaveBeenCalledTimes(1));
  });
  return vi.mocked(runMultiFileTrace).mock.calls[0]?.[2]?.output;
}

describe('Multi-File Trace page choice', () => {
  it('defaults to the image page, hides the margin, and sends no page option', async () => {
    mount();
    expect(pageSelect().value).toBe('image');
    expect(marginInput()).toBeNull();
    expect(await submitAndReadOutput()).toEqual({
      format: 'svg',
      groupContours: false,
      precisionMm: DEFAULT_EXPORT_PRECISION_MM,
    });
  });

  it('fits the page to the artwork with the typed margin and remembers it', async () => {
    mount();
    act(() => {
      pageSelect().value = 'artwork';
      pageSelect().dispatchEvent(new Event('change', { bubbles: true }));
    });
    const margin = marginInput();
    if (margin === null) throw new Error('No margin input.');
    typeInto(margin, '3.5');
    typeInto(margin, '2.5');
    expect(await submitAndReadOutput()).toEqual({
      format: 'svg',
      groupContours: false,
      precisionMm: DEFAULT_EXPORT_PRECISION_MM,
      page: { fit: 'artwork', marginMm: 2.5 },
    });
    act(() => root?.unmount());
    host?.remove();
    mount();
    expect(pageSelect().value).toBe('artwork');
    expect(marginInput()?.value).toBe('2.5');
  });

  it.each(['-2', '1001'])('blocks the trace while the margin field shows %s', async (text) => {
    mount();
    act(() => {
      pageSelect().value = 'artwork';
      pageSelect().dispatchEvent(new Event('change', { bubbles: true }));
    });
    const margin = marginInput();
    if (margin === null) throw new Error('No margin input.');
    typeInto(margin, '3.5');
    typeInto(margin, text);
    expect(margin.getAttribute('aria-invalid')).toBe('true');
    expect(margin.validity.valid).toBe(false);
    const submit = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Choose Images...',
    );
    act(() => submit?.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(runMultiFileTrace).not.toHaveBeenCalled();
    // Correcting the field clears the error and the trace runs with the shown margin.
    typeInto(margin, '4');
    expect(margin.getAttribute('aria-invalid')).toBe('false');
    expect(await submitAndReadOutput()).toMatchObject({ page: { fit: 'artwork', marginMm: 4 } });
  });

  it('treats a cleared margin field as no margin', async () => {
    mount();
    act(() => {
      pageSelect().value = 'artwork';
      pageSelect().dispatchEvent(new Event('change', { bubbles: true }));
    });
    const margin = marginInput();
    if (margin === null) throw new Error('No margin input.');
    typeInto(margin, '3.5');
    typeInto(margin, '');
    expect(margin.getAttribute('aria-invalid')).toBe('false');
    expect(await submitAndReadOutput()).toMatchObject({ page: { fit: 'artwork', marginMm: 0 } });
  });
});
