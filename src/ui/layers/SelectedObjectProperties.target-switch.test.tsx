import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { SelectedObjectProperties } from './SelectedObjectProperties';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
  resetStore();
});

async function render(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<SelectedObjectProperties />));
  return { host, root };
}

async function change(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value;
    Simulate.change(select);
  });
}

async function cleanup(root: Root, host: HTMLDivElement): Promise<void> {
  await act(async () => root.unmount());
  host.remove();
}

describe('SelectedObjectProperties target switching', () => {
  it('does not retarget a pending power-scale edit when inspected artwork changes', async () => {
    vi.useFakeTimers();
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#000000']));
    useStore.getState().selectObject(null);
    const { host, root } = await render();
    try {
      const powerScale = host.querySelector(
        'input[aria-label="Power scale for inspected artwork"]',
      );
      const chooser = host.querySelector('select[aria-label="Artwork to inspect"]');
      if (!(powerScale instanceof HTMLInputElement)) throw new Error('power scale input missing');
      if (!(chooser instanceof HTMLSelectElement)) throw new Error('artwork chooser missing');

      await change(powerScale, '40');
      await choose(chooser, 'O2');
      await act(async () => vi.advanceTimersByTime(300));

      const objects = useStore.getState().project.scene.objects;
      expect(objects.find((object) => object.id === 'O1')?.powerScale).toBeUndefined();
      expect(objects.find((object) => object.id === 'O2')?.powerScale).toBeUndefined();
    } finally {
      await cleanup(root, host);
    }
  });

  it('does not retarget a pending operation edit when the inspected operation changes', async () => {
    vi.useFakeTimers();
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().addOperationForObjects(['O1']);
    useStore.getState().selectObject(null);
    const initialPowers = useStore.getState().project.scene.layers.map((layer) => layer.power);
    const { host, root } = await render();
    try {
      const power = host.querySelector('input[aria-label="Power for inspected artwork"]');
      const operation = host.querySelector('select[aria-label="Operation to inspect"]');
      if (!(power instanceof HTMLInputElement)) throw new Error('operation power input missing');
      if (!(operation instanceof HTMLSelectElement)) throw new Error('operation chooser missing');
      const nextOperationId = operation.options[1]?.value;
      if (nextOperationId === undefined) throw new Error('second operation missing');

      await change(power, '17');
      await choose(operation, nextOperationId);
      await act(async () => vi.advanceTimersByTime(300));

      expect(useStore.getState().project.scene.layers.map((layer) => layer.power)).toEqual(
        initialPowers,
      );
    } finally {
      await cleanup(root, host);
    }
  });

  it('does not retarget a pending shape edit when inspected artwork changes', async () => {
    vi.useFakeTimers();
    useStore.getState().drawShape(rectangle('S1'));
    useStore.getState().drawShape(rectangle('S2'));
    useStore.getState().selectObject(null);
    const { host, root } = await render();
    try {
      const width = host.querySelector('input[aria-label="Rectangle width"]');
      const chooser = host.querySelector('select[aria-label="Artwork to inspect"]');
      if (!(width instanceof HTMLInputElement)) throw new Error('shape width input missing');
      if (!(chooser instanceof HTMLSelectElement)) throw new Error('artwork chooser missing');

      await change(width, '75');
      await choose(chooser, 'S2');
      await act(async () => vi.advanceTimersByTime(300));

      const widths = useStore
        .getState()
        .project.scene.objects.flatMap((object) =>
          object.kind === 'shape' && object.spec.kind === 'rect' ? [object.spec.widthMm] : [],
        );
      expect(widths).toEqual([40, 40]);
    } finally {
      await cleanup(root, host);
    }
  });

  it('does not retarget a pending image adjustment when inspected artwork changes', async () => {
    vi.useFakeTimers();
    useStore.getState().importRasterImage(raster('I1'));
    useStore.getState().importRasterImage(raster('I2'));
    useStore.getState().selectObject(null);
    const { host, root } = await render();
    try {
      const brightness = host.querySelector('input[aria-label="Brightness for I1.png"]');
      const chooser = host.querySelector('select[aria-label="Artwork to inspect"]');
      if (!(brightness instanceof HTMLInputElement)) throw new Error('brightness input missing');
      if (!(chooser instanceof HTMLSelectElement)) throw new Error('artwork chooser missing');

      await change(brightness, '30');
      await choose(chooser, 'I2');
      await act(async () => vi.advanceTimersByTime(300));

      const brightnessValues = useStore
        .getState()
        .project.scene.objects.filter((object) => object.kind === 'raster-image')
        .map((object) => object.brightness);
      expect(brightnessValues).toEqual([undefined, undefined]);
    } finally {
      await cleanup(root, host);
    }
  });
});

function rectangle(id: string) {
  return createRectangle({
    id,
    color: '#000000',
    spec: { widthMm: 40, heightMm: 20, cornerRadiusMm: 0 },
  });
}

function raster(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 20,
    pixelHeight: 20,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}
