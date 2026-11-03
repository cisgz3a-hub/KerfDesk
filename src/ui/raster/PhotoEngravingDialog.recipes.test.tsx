import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createLayer, IDENTITY_TRANSFORM, type Layer, type RasterImage } from '../../core/scene';
import type { PhotoEngravingApply } from './photo-engraving-apply';
import type { PhotoEngravingPreviewResult } from './photo-engraving-preview';
import type { PhotoEngravingSession } from './photo-engraving-store';
import PhotoEngravingDialog from './PhotoEngravingDialog';

// The photo spans levels 40..210; a removed background sits at pure white.
const HISTOGRAM = (() => {
  const histogram = new Uint32Array(256);
  for (let level = 40; level <= 210; level += 1) histogram[level] = 10;
  histogram[255] = 5000;
  return histogram;
})();

const preview = vi.hoisted(() => ({
  result: null as PhotoEngravingPreviewResult | null,
  materialViews: [] as boolean[],
}));

vi.mock('./use-photo-engraving-preview', () => ({
  usePhotoEngravingPreview: (
    _session: unknown,
    _draft: unknown,
    _current: boolean,
    view = false,
  ) => {
    preview.materialViews.push(view);
    return preview.result;
  },
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  preview.result = null;
  preview.materialViews = [];
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function okResult(): PhotoEngravingPreviewResult {
  return {
    kind: 'ok',
    rgba: new Uint8ClampedArray(4).fill(255),
    sourceHistogram: HISTOGRAM,
    width: 1,
    height: 1,
    sourceWidth: 1,
    sourceHeight: 1,
    displayDecimated: false,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    scanAngleDeg: 0,
    scanCount: 1,
    scanPasses: 1,
    normalization: 'relative-marks',
  };
}

function session(): PhotoEngravingSession {
  const operation: Layer = {
    ...createLayer({ id: 'photo', color: '#808080', mode: 'image' }),
    ditherAlgorithm: 'jarvis',
    linesPerMm: 10,
    power: 60,
    speed: 2400,
  };
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'portrait',
    source: 'portrait.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: btoa(String.fromCharCode(40, 120, 210, 255)),
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'jarvis',
    linesPerMm: 10,
    operationIds: ['photo'],
  };
  return {
    sessionId: 'session',
    image,
    operation,
    projectDocumentEpoch: 1,
    device: DEFAULT_DEVICE_PROFILE,
    sceneObjects: [image],
  };
}

async function render(onApply: (patch: PhotoEngravingApply) => void = vi.fn()): Promise<void> {
  await act(async () => {
    root.render(
      <PhotoEngravingDialog
        session={session()}
        current
        error={null}
        onCancel={vi.fn()}
        onApply={onApply}
        onEditSource={vi.fn()}
        onCalibrateTones={vi.fn()}
      />,
    );
  });
}

async function choose(label: string, option: string): Promise<void> {
  const select = document.body.querySelector(`select[aria-label="${label}"]`);
  if (!(select instanceof HTMLSelectElement)) throw new Error(`${label} missing`);
  const value = [...select.options].find((candidate) => candidate.text.includes(option))?.value;
  if (value === undefined) throw new Error(`${option} missing`);
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function button(text: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`${text} missing`);
  return found;
}

async function apply(onApply: ReturnType<typeof vi.fn<(patch: PhotoEngravingApply) => void>>) {
  await act(async () => document.body.querySelector('form')?.requestSubmit());
  const patch = onApply.mock.calls.at(-1)?.[0];
  if (patch === undefined) throw new Error('Apply was not called');
  return patch;
}

describe('Photo engraving material recipes and Auto tones (ADR-685)', () => {
  it('prepares a slate portrait: light marks, Blue Noise, auto tones and a light sharpen', async () => {
    preview.result = okResult();
    const onApply = vi.fn<(patch: PhotoEngravingApply) => void>();
    await render(onApply);

    await choose('Material recipe', 'Black slate');
    const patch = await apply(onApply);

    expect(patch.layerPatch).toMatchObject({ ditherAlgorithm: 'blue-noise', negativeImage: true });
    expect(patch.imagePatch).toMatchObject({ sharpenAmount: 30, sharpenRadius: 0.7 });
    // 40..210 stretches to the full range; pure white is ignored.
    expect(patch.imagePatch.contrast).toBeGreaterThan(40);
    expect(patch.imagePatch.gamma).not.toBe(1);
    // Choosing a recipe turns on the material view for its colours.
    expect(preview.materialViews.at(-1)).toBe(true);
    expect(document.body.textContent).toContain('On slate');
  });

  it('leaves power, speed and DPI alone', async () => {
    preview.result = okResult();
    const onApply = vi.fn<(patch: PhotoEngravingApply) => void>();
    await render(onApply);
    const before = await apply(onApply);

    await choose('Material recipe', 'Wood');
    const after = await apply(onApply);

    expect(after.layerPatch.linesPerMm).toBe(before.layerPatch.linesPerMm);
    expect(after.layerPatch).not.toHaveProperty('power');
    expect(after.layerPatch).not.toHaveProperty('speed');
    expect(after.layerPatch.negativeImage).toBe(false);
  });

  it('tells you to mirror for a back-engraved clear material', async () => {
    await render();
    await choose('Material recipe', 'Clear acrylic');
    expect(document.body.textContent).toContain('Flip the photo horizontally');
  });

  it('offers Auto tones only once the preview has read the photo', async () => {
    const onApply = vi.fn<(patch: PhotoEngravingApply) => void>();
    await render(onApply);
    expect(button('Auto tones').disabled).toBe(true);

    preview.result = okResult();
    await render(onApply);
    expect(button('Auto tones').disabled).toBe(false);
    await act(async () => button('Auto tones').click());
    const patch = await apply(onApply);
    expect(patch.imagePatch.contrast).toBeGreaterThan(40);
    // Auto tones alone keeps the operation's dither and marking.
    expect(patch.layerPatch).toMatchObject({ ditherAlgorithm: 'jarvis', negativeImage: false });
  });

  // UX audit U3-P2-3: a burn grid too big to preview still read the photo, so
  // Auto tones stays offered beside the plain-words limit.
  it('keeps Auto tones when only the burn grid is too big to preview', async () => {
    const onApply = vi.fn<(patch: PhotoEngravingApply) => void>();
    preview.result = {
      kind: 'error',
      message: 'This photo is too big to preview at this size and resolution.',
      sourceHistogram: HISTOGRAM,
    };
    await render(onApply);
    expect(button('Auto tones').disabled).toBe(false);
    await act(async () => button('Auto tones').click());
    expect((await apply(onApply)).imagePatch.contrast).toBeGreaterThan(40);
  });

  // Rolling audit v9 R8-P2-3: a recipe picked before the first preview applied
  // no tones and the promise of them then disappeared.
  it('applies a recipe’s Auto tones when the preview arrives after it', async () => {
    const onApply = vi.fn<(patch: PhotoEngravingApply) => void>();
    await render(onApply);
    await choose('Material recipe', 'Wood');
    expect(document.body.textContent).toContain(
      'Auto tones apply once the preview has read the photo.',
    );

    preview.result = okResult();
    await render(onApply);
    const patch = await apply(onApply);
    expect(patch.imagePatch.contrast).toBeGreaterThan(40);
    expect(patch.imagePatch.gamma).not.toBe(1);
    expect(document.body.textContent).not.toContain('Auto tones apply once');
  });

  it('keeps a tone the operator set while the recipe waited for the preview', async () => {
    const onApply = vi.fn<(patch: PhotoEngravingApply) => void>();
    await render(onApply);
    await choose('Material recipe', 'Wood');
    const brightness = document.body.querySelector('input[aria-label="Photo brightness"]');
    if (!(brightness instanceof HTMLInputElement)) throw new Error('brightness missing');
    await act(async () => {
      brightness.value = '12';
      Simulate.change(brightness);
    });
    await act(async () => Simulate.blur(brightness));
    expect(document.body.textContent).not.toContain('Auto tones apply once');

    preview.result = okResult();
    await render(onApply);
    const patch = await apply(onApply);
    expect(patch.imagePatch).toMatchObject({ brightness: 12, contrast: 0, gamma: 1 });
  });

  // R8-P3-1: light marks invert the photo, so a white background burns solid.
  it('says how to keep a removed background from burning on light-mark materials', async () => {
    await render();
    await choose('Material recipe', 'Black slate');
    expect(document.body.textContent).toContain('Apply Mask to Image');
    await choose('Material recipe', 'Wood');
    expect(document.body.textContent).not.toContain('Apply Mask to Image');
  });
});
