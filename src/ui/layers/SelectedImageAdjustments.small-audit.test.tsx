import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { SelectedObjectProperties } from './SelectedObjectProperties';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const views: { host: HTMLDivElement; root: Root }[] = [];
beforeEach(() => {
  resetStore();
  vi.useFakeTimers();
});
afterEach(async () => {
  for (const { host, root } of views.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
  vi.useRealTimers();
  resetStore();
});

function image(id: string): RasterImage {
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
    brightness: 0,
    contrast: 0,
    gamma: 1,
  };
}

async function mount(): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  views.push({ host, root });
  await act(async () => root.render(<SelectedObjectProperties />));
  return host;
}

function field(host: HTMLElement, label: string): HTMLInputElement {
  const result = host.querySelector(`input[aria-label="${label}"]`);
  if (!(result instanceof HTMLInputElement)) throw new Error(`${label} missing`);
  return result;
}

async function change(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
}

function savedImage(id: string): RasterImage {
  const result = useStore.getState().project.scene.objects.find((object) => object.id === id);
  if (result?.kind !== 'raster-image') throw new Error(`${id} missing`);
  return result;
}

describe('small numeric audit: image adjustment ownership', () => {
  it.each([
    ['Brightness', 'brightness', '38', 0],
    ['Contrast', 'contrast', '-24', 0],
    ['Gamma', 'gamma', '2.25', 1],
  ] as const)(
    'retires a pending %s edit when a replacement project reuses the image ID and value',
    async (label, property, text, original) => {
      useStore.getState().importRasterImage(image('shared-id'));
      const host = await mount();
      const previous = field(host, `${label} for shared-id.png`);
      await change(previous, text);
      const oldEpoch = useStore.getState().projectDocumentEpoch;
      const replacement = structuredClone(useStore.getState().project);
      await act(async () => useStore.getState().setProject(replacement));
      expect(useStore.getState().projectDocumentEpoch).toBeGreaterThan(oldEpoch);
      await act(async () => vi.advanceTimersByTime(400));
      expect(savedImage('shared-id')[property]).toBe(original);
      expect(field(host, `${label} for shared-id.png`).value).toBe(String(original));
      expect(useStore.getState().dirty).toBe(false);
      expect(useStore.getState().undoStack).toHaveLength(0);
    },
  );

  it('resets a blank adjustment draft on replacement even when the saved scalar is unchanged', async () => {
    useStore.getState().importRasterImage(image('shared-id'));
    const host = await mount();
    await change(field(host, 'Brightness for shared-id.png'), '');
    await act(async () =>
      useStore.getState().setProject(structuredClone(useStore.getState().project)),
    );
    expect(field(host, 'Brightness for shared-id.png').value).toBe('0');
    expect(savedImage('shared-id').brightness).toBe(0);
  });

  it('does not send an unfinished edit to another image with the same initial adjustment', async () => {
    useStore.getState().importRasterImage(image('first'));
    useStore.getState().importRasterImage(image('second'));
    useStore.getState().selectObject('first');
    const host = await mount();
    await change(field(host, 'Brightness for first.png'), '51');
    await act(async () => useStore.getState().selectObject('second'));
    await act(async () => vi.advanceTimersByTime(400));
    expect(savedImage('first').brightness).toBe(0);
    expect(savedImage('second').brightness).toBe(0);
    expect(field(host, 'Brightness for second.png').value).toBe('0');
  });

  it('still commits the current image edit exactly once, including its blur after the timer', async () => {
    useStore.getState().importRasterImage(image('current'));
    const host = await mount();
    const input = field(host, 'Brightness for current.png');
    const undoBefore = useStore.getState().undoStack.length;
    await change(input, '-12.5');
    await act(async () => vi.advanceTimersByTime(400));
    expect(savedImage('current').brightness).toBe(-12.5);
    await act(async () => Simulate.blur(input));
    expect(savedImage('current').brightness).toBe(-12.5);
    expect(useStore.getState().undoStack.length).toBe(undoBefore + 1);
  });
});
