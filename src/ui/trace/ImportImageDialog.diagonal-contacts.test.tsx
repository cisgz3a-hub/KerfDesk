// ADR-455: the Diagonal contacts choice travels with the committed trace
// (ADR-408) through the real dialog, the real project serializer and the
// real Re-trace command; a trace recorded before the control reopens on Auto.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./image-loader', () => ({
  PREVIEW_MAX_EDGE_PX: 2048,
  loadImageAsRawData: vi.fn(async () => ({
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ]),
  })),
  dataUrlToFile: vi.fn(async () => new File(['image'], 'logo.png', { type: 'image/png' })),
}));
vi.mock('./use-trace-worker-client', () => ({
  traceImageWithFallback: vi.fn(async () => ({
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            points: [
              { x: 10, y: 10 },
              { x: 60, y: 10 },
              { x: 60, y: 50 },
            ],
            closed: true,
          },
        ],
      },
    ],
    bounds: { minX: 10, minY: 10, maxX: 60, maxY: 50 },
    width: 100,
    height: 80,
  })),
  isTraceRequestSuperseded: () => false,
}));

import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { retraceOriginalAction } from '../commands/image-command-actions';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { ImportImageDialog } from './ImportImageDialog';
import { traceImageWithFallback } from './use-trace-worker-client';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const prior = useStore.getState();

afterEach(() => {
  useStore.setState(prior, true);
  useUiStore.setState({ imageDialog: null });
  vi.mocked(traceImageWithFallback).mockClear();
});

const seed: RasterImage = {
  kind: 'raster-image',
  id: 'src-1',
  source: 'logo.png',
  dataUrl: 'data:image/png;base64,AAA',
  pixelWidth: 100,
  pixelHeight: 80,
  bounds: { minX: 0, minY: 0, maxX: 50, maxY: 40 },
  transform: IDENTITY_TRANSFORM,
  color: '#808080',
  dither: 'floyd-steinberg',
  linesPerMm: 10,
};

function projectWith(...objects: Project['scene']['objects']): Project {
  const base = createProject();
  return { ...base, scene: { ...base.scene, objects } };
}

describe('Diagonal contacts survives Re-trace Original (ADR-455)', () => {
  it('commit -> save -> load -> Re-trace reopens on the chosen policy', async () => {
    const traceExistingImage = vi.fn();
    useStore.setState({ project: projectWith(seed), traceExistingImage });
    useUiStore.getState().openImageDialog(seed);
    const first = await renderDialog();
    try {
      await changeSelect(contactsSelect(first.host), 'connect-ink');
      await submit(first.host);
    } finally {
      await first.unmount();
    }
    // The preview trace that ran after the change asked the engine for it.
    const traced = vi.mocked(traceImageWithFallback).mock.calls.map((call) => call[1]);
    expect(traced.some((options) => options?.turnPolicy === 'connect-ink')).toBe(true);
    const committed = traceExistingImage.mock.calls[0]?.[1] as TracedImage;
    expect(committed.traceSettings?.overrides).toEqual({ turnPolicy: 'connect-ink' });

    const loaded = deserializeProject(
      serializeProject(
        projectWith({ ...seed, role: 'trace-source' }, { ...committed, traceSourceId: seed.id }),
      ),
    );
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') return;
    const trace = loaded.project.scene.objects[1];
    if (trace?.kind !== 'traced-image') throw new Error('trace did not load');
    expect(trace.traceSettings).toEqual(committed.traceSettings);
    const second = await retrace(loaded.project, trace);
    try {
      expect(contactsSelect(second.host)?.value).toBe('connect-ink');
    } finally {
      await second.unmount();
    }
  });

  it('opens a trace recorded before the control on Auto', async () => {
    const older: TracedImage = {
      kind: 'traced-image',
      id: 'older-trace',
      source: 'logo.png',
      traceSourceId: seed.id,
      traceMode: 'filled-contours',
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      transform: IDENTITY_TRANSFORM,
      paths: [{ color: '#000000', polylines: [] }],
      traceSettings: {
        schemaVersion: 1,
        presetName: 'Smooth',
        overrides: { smoothness: 0.5 },
        output: 'vector',
        fillStyle: 'scanline',
      },
    };
    const view = await retrace(projectWith({ ...seed, role: 'trace-source' }, older), older);
    try {
      expect(contactsSelect(view.host)?.value).toBe('auto');
      const traced = vi.mocked(traceImageWithFallback).mock.calls.map((call) => call[1]);
      expect(traced.length).toBeGreaterThan(0);
      expect(traced.every((options) => options?.turnPolicy === undefined)).toBe(true);
    } finally {
      await view.unmount();
    }
  });
});

async function retrace(project: Project, trace: TracedImage): Promise<Mounted> {
  useStore.setState({ project, traceExistingImage: vi.fn() });
  retraceOriginalAction(project, trace, useUiStore.getState().openImageDialog, vi.fn())();
  const view = await renderDialog();
  await waitForPreview();
  return view;
}

type Mounted = { readonly host: HTMLDivElement; readonly unmount: () => Promise<void> };

async function renderDialog(): Promise<Mounted> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(ImportImageDialog));
  });
  if (root === null) throw new Error('root did not mount');
  const mounted: Root = root;
  return {
    host,
    unmount: async () => {
      await act(async () => mounted.unmount());
      host.remove();
    },
  };
}

async function waitForPreview(): Promise<void> {
  for (let i = 0; i < 40 && vi.mocked(traceImageWithFallback).mock.calls.length === 0; i += 1)
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 25)));
}

async function submit(host: HTMLElement): Promise<void> {
  await waitForPreview();
  for (let i = 0; i < 20; i += 1) {
    const button = host.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    if (button !== null && !button.disabled) break;
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 10)));
  }
  await act(async () => {
    host.querySelector('form')?.requestSubmit();
  });
  for (let i = 0; i < 10; i += 1) await act(async () => undefined);
}

function contactsSelect(host: HTMLElement): HTMLSelectElement | null {
  return host.querySelector('select[aria-label="Trace diagonal contacts"]');
}

async function changeSelect(select: HTMLSelectElement | null, value: string): Promise<void> {
  expect(select).toBeInstanceOf(HTMLSelectElement);
  await act(async () => {
    if (select === null) return;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
