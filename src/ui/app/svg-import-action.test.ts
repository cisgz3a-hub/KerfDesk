import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSvgInWorker } from '../../io/svg/parse-svg-worker';
import { Toasts } from '../common/Toasts';
import { resetDocumentImportWorkerForTests } from '../import/document-import-worker-client';
import type {
  DocumentImportWorkerRequest,
  DocumentImportWorkerResponse,
} from '../import/document-import-worker-protocol';
import { useToastStore } from '../state/toast-store';
import { importSvgFiles } from './svg-import-action';

const PRESENTATION_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">' +
  '<rect width="10" height="10" fill="red" mask="url(#mask)" filter="url(#filter)"/></svg>';
const PRESENTATION_WARNINGS = [
  'revision.svg: SVG presentation: Imported 1 SVG element(s) without their masks; areas the masks hide are included.',
  'revision.svg: SVG presentation: Imported 1 SVG element(s) without their filter effects.',
];

class StubWorker {
  static instance: StubWorker | null = null;
  onmessage: ((event: MessageEvent<DocumentImportWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  request: DocumentImportWorkerRequest | null = null;
  constructor() {
    StubWorker.instance = this;
  }
  postMessage(request: DocumentImportWorkerRequest): void {
    this.request = request;
  }
  terminate(): void {
    this.request = null;
  }
  reply(response: DocumentImportWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<DocumentImportWorkerResponse>);
  }
}

async function replyWithPresentationSvg(extraNotes: readonly string[] = []): Promise<void> {
  await vi.waitFor(() => expect(StubWorker.instance?.request?.kind).toBe('svg'));
  const worker = StubWorker.instance;
  const request = worker?.request;
  if (worker === null || request?.kind !== 'svg') throw new Error('Missing SVG worker request');
  const result = parseSvgInWorker({
    svgText: PRESENTATION_SVG,
    id: 'revision',
    source: 'revision.svg',
  });
  worker.reply({
    id: request.id,
    kind: 'svg',
    result: { ...result, notes: [...result.notes, ...extraNotes] },
  });
}

afterEach(() => {
  resetDocumentImportWorkerForTests();
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  vi.unstubAllGlobals();
});

describe('importSvgFiles', () => {
  it.each([
    ['main-thread text', 'added'],
    ['main-thread text', 'replaced'],
    ['worker reply', 'added'],
    ['worker reply', 'replaced'],
  ] as const)(
    'reports current presentation warnings after the %s %s summary',
    async (parser, kind) => {
      const outcome =
        kind === 'added'
          ? { kind }
          : { kind, source: 'revision.svg', kept: 1, added: 0, removed: 0 };
      const importObject = vi.fn(() => outcome);
      const importFragment = vi.fn(() => outcome);
      const pushToast = vi.fn();
      const text = vi.fn(async () => PRESENTATION_SVG);
      if (parser === 'worker reply') vi.stubGlobal('Worker', StubWorker);
      const source = {
        name: 'revision.svg',
        text,
        ...(parser === 'worker reply' ? { blob: async () => new Blob([PRESENTATION_SVG]) } : {}),
      };
      const pending = importSvgFiles(
        [source],
        importObject,
        pushToast,
        parser === 'worker reply' ? { importFragment } : {},
      );
      if (parser === 'worker reply') await replyWithPresentationSvg();
      await pending;

      const committed = parser === 'worker reply' ? importFragment : importObject;
      expect(committed).toHaveBeenCalledOnce();
      expect(parser === 'worker reply' ? importObject : importFragment).not.toHaveBeenCalled();
      // Worker progress is informational and precedes the completed import.
      expect(pushToast.mock.calls.filter(([, variant]) => variant !== 'info')).toEqual([
        [
          kind === 'added'
            ? 'Imported revision.svg — 1 object, 1 color'
            : 'Re-imported revision.svg — layer settings preserved (1 kept)',
          'success',
        ],
        ...PRESENTATION_WARNINGS.map((message) => [message, 'warning']),
      ]);
      if (parser === 'worker reply') expect(text).not.toHaveBeenCalled();
    },
  );

  it('reports only the replacement summary when the current SVG has no presentation notes', async () => {
    const pushToast = vi.fn();
    await importSvgFiles(
      [
        {
          name: 'clean.svg',
          text: async () => PRESENTATION_SVG.replace(/ (?:mask|filter)="[^"]*"/g, ''),
        },
      ],
      () => ({ kind: 'replaced', source: 'clean.svg', kept: 0, added: 1, removed: 1 }),
      pushToast,
    );
    expect(pushToast.mock.calls).toEqual([
      ['Re-imported clean.svg — new layer settings (1 new, 1 removed)', 'success'],
    ]);
  });

  it.each(['added', 'replaced'] as const)(
    'keeps the final opacity warning visible among mixed notes for a %s import',
    async (kind) => {
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      vi.stubGlobal('Worker', StubWorker);
      const opacityNote = 'SVG presentation: Unresolved fill opacity was treated as fully opaque.';
      const outcome =
        kind === 'added'
          ? {
              kind,
              bedFit: {
                scale: 0.36,
                widthMm: 1000,
                heightMm: 500,
                bedWidthMm: 400,
                bedHeightMm: 400,
              },
            }
          : { kind, source: 'revision.svg', kept: 1, added: 0, removed: 0 };
      const pending = importSvgFiles(
        [
          {
            name: 'revision.svg',
            text: async () => PRESENTATION_SVG,
            blob: async () => new Blob([PRESENTATION_SVG]),
          },
        ],
        () => outcome,
        useToastStore.getState().pushToast,
      );
      // The reporting layer receives already ordered parser notes. Retain the
      // last qualified warning even when other notes and bed-fit also report.
      await replyWithPresentationSvg([
        'SVG presentation: Skipped an embedded image with unsupported data.',
        'SVG presentation: Skipped an embedded image with unsupported effects.',
        opacityNote,
      ]);
      await pending;
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      try {
        await act(async () => root.render(createElement(Toasts)));
        const visible = [...host.querySelectorAll('.lf-toast__message')].map(
          (element) => element.textContent,
        );
        expect(visible).toHaveLength(3);
        expect(visible).toContain('Warning: revision.svg: ' + opacityNote);
        expect(visible.at(-1)).toContain(
          kind === 'added' ? 'so it was scaled to 36% to fit' : opacityNote,
        );
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );

  it('sends a reachable Blob to the document worker without UI-thread text reading', async () => {
    vi.stubGlobal('Worker', StubWorker);
    const text = vi.fn(async () => '<svg/>');
    const source = {
      name: 'part.svg',
      size: 6,
      text,
      blob: async () => new Blob(['<svg/>']),
    };
    const pending = importSvgFiles(
      [source],
      vi.fn(() => ({ kind: 'added' as const })),
      vi.fn(),
    );
    await vi.waitFor(() => expect(StubWorker.instance?.request?.kind).toBe('svg'));
    const request = StubWorker.instance?.request;
    StubWorker.instance?.reply({
      id: request?.id ?? -1,
      kind: 'svg',
      result: {
        object: null,
        stripped: { scripts: 0, foreignObjects: 0, externalLinks: 0, dataUris: 0 },
        notes: ['SVG has no drawable geometry'],
        ignoredTextElements: 0,
        ignoredImageElements: 0,
      },
    });
    await pending;

    expect(text).not.toHaveBeenCalled();
  });

  it('imports through the disclosed main-thread fallback when worker construction fails', async () => {
    vi.stubGlobal('Worker', function WorkerUnavailable(): never {
      throw new Error('workers blocked');
    });
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect x="5" y="5" width="30" height="20" fill="none" stroke="#f00"/></svg>';
    const blob = { size: svg.length } as unknown as Blob;
    const readFile = vi.fn(async () => svg);
    const importObject = vi.fn(() => ({ kind: 'added' as const }));
    const pushToast = vi.fn();

    await importSvgFiles(
      [{ name: 'fallback.svg', text: readFile, blob: async () => blob }],
      importObject,
      pushToast,
    );

    expect(readFile).toHaveBeenCalledOnce();
    expect(importObject).toHaveBeenCalledOnce();
    expect(pushToast).toHaveBeenCalledWith(
      expect.stringMatching(/fallback\.svg.*main thread.*unresponsive/i),
      'warning',
    );
  });

  it('reports a scale-to-fit after the import toasts so it stays in view', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1000mm" height="500mm" viewBox="0 0 1000 500"><text>x</text><rect width="10" height="10" stroke="#f00"/></svg>';
    const bedFit = { scale: 0.36, widthMm: 1000, heightMm: 500, bedWidthMm: 400, bedHeightMm: 400 };
    const pushToast = vi.fn();

    await importSvgFiles(
      [{ name: 'banner.svg', text: async () => svg }],
      vi.fn(() => ({ kind: 'added' as const, bedFit })),
      pushToast,
    );

    const messages = pushToast.mock.calls.map(([message]) => String(message));
    expect(messages.slice(0, -1)).toContainEqual(expect.stringMatching(/text element.*ignored/));
    expect(pushToast).toHaveBeenLastCalledWith(
      'banner.svg is larger than the 400 × 400 mm bed (1000 × 500 mm), so it was scaled to 36% ' +
        'to fit. Undo restores the original size.',
      'warning',
    );
  });
});
