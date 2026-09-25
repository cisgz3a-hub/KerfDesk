// ADR-400: the Trace dialog's settings travel with the committed trace, survive
// project save/load, and pre-fill the dialog when the operator chooses
// Re-trace Original. Driven through the real dialog, the real project
// serializer/deserializer and the real Re-trace command.
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
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type SceneObject,
  type TracedImage,
} from '../../core/scene';
import {
  deserializeProject,
  prepareProjectForPersistence,
  serializeProject,
} from '../../io/project';
import { retraceOriginalAction } from '../commands/image-command-actions';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { ImportImageDialog } from './ImportImageDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const prior = useStore.getState();

afterEach(() => {
  useStore.setState(prior, true);
  useUiStore.setState({ imageDialog: null });
});

function seedRaster(): RasterImage {
  return {
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
}

function projectWith(...objects: Project['scene']['objects']): Project {
  const base = createProject();
  return { ...base, scene: { ...base.scene, objects } };
}

describe('Re-trace Original keeps the committed trace settings (ADR-400)', () => {
  it('commit -> save -> load -> Re-trace shows the same settings, and a second commit keeps them', async () => {
    const traceExistingImage = vi.fn();
    const seed = seedRaster();
    useStore.setState({ project: projectWith(seed), traceExistingImage });

    // 1. First trace: choose non-default settings and commit.
    useUiStore.getState().openImageDialog(seed);
    const first = await renderDialog();
    try {
      await changeSelect(presetSelect(first.host), 'Smooth');
      await changeSelect(fillStyleSelect(first.host), 'offset');
      await changeNumber(numberInput(first.host, 'Trace Smoothness'), '0.5');
      await dragBoundary(first.host);
      await changeSelect(boundaryModeSelect(first.host), 'enhance');
      await submit(first.host);
    } finally {
      await first.unmount();
    }
    expect(traceExistingImage).toHaveBeenCalledTimes(1);
    const committed = traceExistingImage.mock.calls[0]?.[1] as TracedImage;
    expect(committed.traceSettings).toEqual({
      schemaVersion: 1,
      presetName: 'Smooth',
      overrides: { smoothness: 0.5 },
      output: 'vector',
      fillStyle: 'offset',
      boundary: { x: 10, y: 10, width: 50, height: 40 },
      boundaryMode: 'enhance',
    });

    // 2. Save and reopen the project through the real .lf2 boundary.
    const saved: Project = projectWith(
      { ...seed, role: 'trace-source' },
      { ...committed, traceSourceId: seed.id },
    );
    const loaded = deserializeProject(serializeProject(saved));
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') return;
    const loadedTrace = loaded.project.scene.objects[1];
    expect(loadedTrace?.kind).toBe('traced-image');
    if (loadedTrace?.kind !== 'traced-image') return;
    expect(loadedTrace.traceSettings).toEqual(committed.traceSettings);

    // 3. Re-trace Original on the loaded trace reopens the dialog pre-filled.
    traceExistingImage.mockClear();
    useStore.setState({ project: loaded.project, traceExistingImage });
    const pushToast = vi.fn();
    retraceOriginalAction(
      loaded.project,
      loadedTrace,
      useUiStore.getState().openImageDialog,
      pushToast,
    )();
    expect(pushToast).not.toHaveBeenCalled();
    const second = await renderDialog();
    try {
      expect(presetSelect(second.host).value).toBe('Smooth');
      expect(fillStyleSelect(second.host)?.value).toBe('offset');
      expect(outputSelect(second.host)?.value).toBe('vector');
      expect(numberInput(second.host, 'Trace Smoothness').value).toBe('0.5');
      expect(boundaryModeSelect(second.host)?.value).toBe('enhance');
      // Re-trace exists only because the source was kept; keep it again.
      expect(checkboxByLabel(second.host, 'Delete Image After trace')?.checked).toBe(false);

      // 4. Retrace and commit again: the settings stay with the replacement.
      await submit(second.host);
    } finally {
      await second.unmount();
    }
    expect(traceExistingImage).toHaveBeenCalledTimes(1);
    const recommitted = traceExistingImage.mock.calls[0]?.[1] as TracedImage;
    expect(recommitted.id).toBe(loadedTrace.id);
    expect(recommitted.traceSettings).toEqual(committed.traceSettings);
    expect(traceExistingImage.mock.calls[0]?.[2]).toMatchObject({
      deleteSourceAfterTrace: false,
      replaceTraceId: loadedTrace.id,
    });
  });

  it('opens a legacy trace without recorded settings on the defaults', async () => {
    const seed = seedRaster();
    const legacy: TracedImage = {
      kind: 'traced-image',
      id: 'legacy-trace',
      source: 'logo.png',
      traceSourceId: seed.id,
      traceMode: 'filled-contours',
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      transform: IDENTITY_TRANSFORM,
      paths: [{ color: '#000000', polylines: [] }],
    };
    const project = projectWith({ ...seed, role: 'trace-source' }, legacy);
    useStore.setState({ project });
    retraceOriginalAction(project, legacy, useUiStore.getState().openImageDialog, vi.fn())();
    const view = await renderDialog();
    try {
      expect(presetSelect(view.host).value).toBe('Line Art');
      expect(fillStyleSelect(view.host)?.value).toBe('scanline');
      expect(boundaryModeSelect(view.host)).toBeNull();
    } finally {
      await view.unmount();
    }
  });

  it('ignores recorded values the current dialog cannot honour', async () => {
    const seed = seedRaster();
    const trace: TracedImage = {
      kind: 'traced-image',
      id: 'future-trace',
      source: 'logo.png',
      traceSourceId: seed.id,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      transform: IDENTITY_TRANSFORM,
      paths: [{ color: '#000000', polylines: [] }],
      traceSettings: {
        schemaVersion: 1,
        presetName: 'Preset From The Future',
        overrides: { smoothness: 'very', futureKnob: 3, optimize: 0.4 },
        // Outside the 100 x 80 source grid: nothing usable remains.
        boundary: { x: 500, y: 500, width: 10, height: 10 },
        boundaryMode: 'enhance',
      },
    };
    const project = projectWith({ ...seed, role: 'trace-source' }, trace);
    useStore.setState({ project });
    retraceOriginalAction(project, trace, useUiStore.getState().openImageDialog, vi.fn())();
    const view = await renderDialog();
    try {
      expect(presetSelect(view.host).value).toBe('Line Art');
      expect(numberInput(view.host, 'Trace Optimize').value).toBe('0.4');
      expect(boundaryModeSelect(view.host)).toBeNull();
    } finally {
      await view.unmount();
    }
  });
});

describe('the real store keeps the recorded settings through save (ADR-400)', () => {
  it.each(['laser', 'cnc'] as const)(
    '%s: commit and re-trace through the store, then save and reload',
    async (machineKind) => {
      const seed = seedRaster();
      const base = projectWith(seed);
      useStore.setState({
        project: machineKind === 'cnc' ? { ...base, machine: DEFAULT_CNC_MACHINE_CONFIG } : base,
      });

      // First trace through the real store action; keep the source so it can
      // be re-traced.
      useUiStore.getState().openImageDialog(seed);
      const first = await renderDialog();
      try {
        await changeSelect(presetSelect(first.host), 'Sharp');
        await changeNumber(numberInput(first.host, 'Trace Smoothness'), '0.5');
        await setCheckbox(checkboxByLabel(first.host, 'Delete Image After trace'), false);
        await submit(first.host);
      } finally {
        await first.unmount();
      }
      const committed = savedTrace(useStore.getState().project);
      expect(committed.traceSettings).toMatchObject({
        presetName: 'Sharp',
        overrides: { smoothness: 0.5 },
      });

      // Re-trace through the real command and store, with one more edit.
      const project = useStore.getState().project;
      retraceOriginalAction(project, committed, useUiStore.getState().openImageDialog, vi.fn())();
      const second = await renderDialog();
      try {
        expect(presetSelect(second.host).value).toBe('Sharp');
        await changeNumber(numberInput(second.host, 'Trace Optimize'), '0.4');
        await submit(second.host);
      } finally {
        await second.unmount();
      }
      const replaced = savedTrace(useStore.getState().project);
      expect(replaced.id).toBe(committed.id);
      expect(replaced.traceSettings).toMatchObject({
        presetName: 'Sharp',
        overrides: { smoothness: 0.5, optimize: 0.4 },
      });

      // Save exactly as the app does, then reopen.
      const prepared = prepareProjectForPersistence(useStore.getState().project);
      expect(prepared.kind).toBe('ok');
      if (prepared.kind !== 'ok') return;
      expect(savedTrace(prepared.project).traceSettings).toEqual(replaced.traceSettings);
      const reopened = deserializeProject(prepared.json);
      expect(reopened.kind).toBe('ok');
      if (reopened.kind !== 'ok') return;
      expect(savedTrace(reopened.project).traceSettings).toEqual(replaced.traceSettings);
    },
  );

  it('keeps the settings on a rasterized trace result committed through the store', () => {
    const seed = seedRaster();
    useStore.setState({ project: projectWith(seed) });
    const traceSettings = {
      schemaVersion: 1,
      presetName: 'Line Art',
      overrides: { cutoffLuma: 20 },
      output: 'raster',
    } as const;
    useStore.getState().commitRasterizedTrace(seed.id, {
      ...seedRaster(),
      id: 'raster-trace',
      source: 'logo.png (bitmap)',
      traceSettings,
    });
    const prepared = prepareProjectForPersistence(useStore.getState().project);
    expect(prepared.kind).toBe('ok');
    if (prepared.kind !== 'ok') return;
    const raster = prepared.project.scene.objects.find((obj) => obj.id === 'raster-trace');
    expect(raster).toMatchObject({ traceSourceId: seed.id, traceSettings });
  });
});

function savedTrace(project: Project): TracedImage {
  const trace = project.scene.objects.find(
    (obj: SceneObject): obj is TracedImage => obj.kind === 'traced-image',
  );
  if (trace === undefined) throw new Error('no traced image in the project');
  return trace;
}

async function setCheckbox(input: HTMLInputElement | null, checked: boolean): Promise<void> {
  expect(input).toBeInstanceOf(HTMLInputElement);
  if (input === null || input.checked === checked) return;
  await act(async () => {
    input.click();
  });
}

async function renderDialog(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
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

async function submit(host: HTMLElement): Promise<void> {
  // Wait for the source file to load so the Trace button is enabled.
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

async function dragBoundary(host: HTMLElement): Promise<void> {
  const frame = host.querySelector('[aria-label="Trace preview"]') as HTMLDivElement | null;
  expect(frame).not.toBeNull();
  if (frame === null) return;
  frame.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 100,
      height: 80,
      right: 100,
      bottom: 80,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    }) as DOMRect;
  await act(async () => {
    frame.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
    frame.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 50, bubbles: true }));
    frame.dispatchEvent(new MouseEvent('mouseup', { clientX: 60, clientY: 50, bubbles: true }));
  });
}

function presetSelect(host: HTMLElement): HTMLSelectElement {
  const select = host.querySelector('select[aria-label="Trace preset"]');
  expect(select).toBeInstanceOf(HTMLSelectElement);
  return select as HTMLSelectElement;
}

function fillStyleSelect(host: HTMLElement): HTMLSelectElement | null {
  return host.querySelector('select[aria-label="Trace fill style"]');
}

function outputSelect(host: HTMLElement): HTMLSelectElement | null {
  return host.querySelector('select[aria-label="Trace output"]');
}

function boundaryModeSelect(host: HTMLElement): HTMLSelectElement | null {
  return host.querySelector('select[aria-label="Trace boundary mode"]');
}

function numberInput(host: HTMLElement, label: string): HTMLInputElement {
  const input = host.querySelector(`input[type="number"][aria-label="${label}"]`);
  expect(input).toBeInstanceOf(HTMLInputElement);
  return input as HTMLInputElement;
}

function checkboxByLabel(host: HTMLElement, label: string): HTMLInputElement | null {
  return (
    Array.from(host.querySelectorAll('label'))
      .find((row) => row.textContent?.includes(label))
      ?.querySelector('input[type="checkbox"]') ?? null
  );
}

async function changeSelect(select: HTMLSelectElement | null, value: string): Promise<void> {
  expect(select).toBeInstanceOf(HTMLSelectElement);
  await act(async () => {
    if (select === null) return;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function changeNumber(input: HTMLInputElement, value: string): Promise<void> {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
