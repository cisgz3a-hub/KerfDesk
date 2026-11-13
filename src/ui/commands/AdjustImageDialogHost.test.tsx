// Tools audit T1, T14: Adjust Image says when OK also changes other images on
// the same operation (T14-P2-1), and stays bound to the image it was opened on
// when the selection changes underneath it (T14R-P2-1).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { AdjustImageDialogHost } from './AdjustImageDialogHost';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const st = () => useStore.getState();

function photo(id: string, source: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 2,
    pixelHeight: 1,
    lumaBase64: 'AP8=',
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 1,
  };
}

function image(id: string): RasterImage {
  const object = st().project.scene.objects.find((candidate) => candidate.id === id);
  if (object?.kind !== 'raster-image') throw new Error(`no image ${id}`);
  return object;
}

let host: HTMLDivElement;
let root: Root;
let closed = 0;

async function mount(imageId: string): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<AdjustImageDialogHost imageId={imageId} onClose={() => (closed += 1)} />);
  });
  const dialog = document.querySelector<HTMLElement>('[aria-label="Adjust Image"]');
  if (dialog === null) throw new Error('dialog did not open');
  return dialog;
}

async function tick(dialog: HTMLElement, name: string): Promise<void> {
  const box = dialog.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (box === null) throw new Error(`no ${name}`);
  await act(async () => box.click());
}

async function pressOk(dialog: HTMLElement): Promise<void> {
  const ok = [...dialog.querySelectorAll('button')].find((button) => button.textContent === 'OK');
  if (ok === undefined) throw new Error('no OK');
  await act(async () => ok.click());
}

beforeEach(() => {
  resetStore();
  closed = 0;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('Adjust Image host', () => {
  it('says which fields also change the other images on a shared operation', async () => {
    st().importRasterImage(photo('A', 'alpha.png'));
    st().duplicateSelection();
    const b = st().selectedObjectId ?? '';
    const dialog = await mount(b);
    const note = dialog.querySelector('[role="note"]')?.textContent ?? '';
    expect(note).toContain('Negative Image');
    expect(note).toContain('1 other image');
  });

  it('says nothing about sharing for an image alone on its operation', async () => {
    st().importRasterImage(photo('A', 'alpha.png'));
    const dialog = await mount(st().selectedObjectId ?? '');
    expect(dialog.querySelector('[role="note"]')).toBeNull();
  });

  it('applies to the image it was opened on after the selection moves to another image', async () => {
    st().importRasterImage(photo('C', 'charlie.png'));
    const c = st().selectedObjectId ?? '';
    st().importRasterImage(photo('B', 'bravo.png'));
    const b = st().selectedObjectId ?? '';
    const dialog = await mount(b);
    await tick(dialog, 'negativeImage');

    // Another surface (canvas, phone, MCP) selects C while the dialog is open.
    await act(async () => useStore.setState({ selectedObjectId: c }));
    expect(dialog.textContent).toContain('bravo.png');

    await pressOk(dialog);
    const scene = st().project.scene;
    const opOf = (id: string) =>
      scene.layers.find((layer) => image(id).operationIds?.includes(layer.id));
    expect(opOf(b)?.negativeImage).toBe(true);
    expect(opOf(c)?.negativeImage).not.toBe(true);
  });

  it('closes when its image is deleted', async () => {
    st().importRasterImage(photo('A', 'alpha.png'));
    const a = st().selectedObjectId ?? '';
    await mount(a);
    await act(async () => st().removeSceneObject(a));
    expect(closed).toBe(1);
  });
});
