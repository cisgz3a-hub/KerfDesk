import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
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

function select(label: string): HTMLSelectElement {
  const found = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  if (found === null) throw new Error(`No ${label} select.`);
  return found;
}

function input(label: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (found === null) throw new Error(`No ${label} input.`);
  return found;
}

function choose(label: string, value: string): void {
  act(() => {
    select(label).value = value;
    select(label).dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function typeInto(field: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function tickPerSide(): void {
  const box = [...document.querySelectorAll<HTMLLabelElement>('label')]
    .find((label) => label.textContent === 'Per-side margins')
    ?.querySelector('input');
  if (box === null || box === undefined) throw new Error('No Per-side margins checkbox.');
  act(() => box.click());
}

async function submitAndReadDeps(): Promise<Parameters<typeof runMultiFileTrace>[2]> {
  await chooseImagesAndTrace();
  await act(async () => {
    await vi.waitFor(() => expect(runMultiFileTrace).toHaveBeenCalledTimes(1));
  });
  return vi.mocked(runMultiFileTrace).mock.calls[0]?.[2];
}

describe('Multi-File Trace paper pages and size (rank 33)', () => {
  it('sends an A4 page with the shared margin', async () => {
    mount();
    choose('Page size', 'a4');
    typeInto(input('Page margin'), '10');
    expect(select('Output size').value).toBe('file');
    const deps = await submitAndReadDeps();
    expect(deps?.output?.page).toEqual({
      fit: 'paper',
      paperMm: { width: 210, height: 297 },
      marginMm: 10,
    });
    expect(deps?.size).toBeUndefined();
  });

  it('sends Letter paper with the margin shown', async () => {
    mount();
    choose('Page size', 'letter');
    // The dialog remembers the last batch's margin (10 mm above).
    expect(input('Page margin').value).toBe('10');
    typeInto(input('Page margin'), '');
    const deps = await submitAndReadDeps();
    expect(deps?.output?.page).toEqual({
      fit: 'paper',
      paperMm: { width: 215.9, height: 279.4 },
      marginMm: 0,
    });
  });

  it('sends a custom page with per-side margins seeded from the shared margin', async () => {
    mount();
    choose('Page size', 'custom');
    typeInto(input('Page width'), '100');
    typeInto(input('Page height'), '50');
    typeInto(input('Page margin'), '2');
    tickPerSide();
    expect(document.querySelector('input[aria-label="Page margin"]')).toBeNull();
    expect(input('Top margin').value).toBe('2');
    typeInto(input('Left margin'), '7');
    const deps = await submitAndReadDeps();
    expect(deps?.output?.page).toEqual({
      fit: 'paper',
      paperMm: { width: 100, height: 50 },
      margins: { top: 2, right: 2, bottom: 2, left: 7 },
    });
  });

  it('blocks the trace while a custom page side is zero', async () => {
    mount();
    choose('Page size', 'custom');
    typeInto(input('Page width'), '0');
    expect(input('Page width').validity.valid).toBe(false);
    expect(input('Page width').getAttribute('aria-invalid')).toBe('true');
  });

  it.each([
    ['dpi', 'Output DPI', '600', { kind: 'dpi', dpi: 600 }],
    ['width', 'Output width', '80', { kind: 'width', widthMm: 80 }],
  ] as const)('sends the %s size override', async (mode, label, text, size) => {
    mount();
    choose('Output size', mode);
    typeInto(input(label), text);
    const deps = await submitAndReadDeps();
    expect(deps?.size).toEqual(size);
  });
});
