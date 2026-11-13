import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { fitPhotoToneCurve } from '../../core/raster/photo-tone-curve';
import { createLayer, IDENTITY_TRANSFORM, type Layer, type RasterImage } from '../../core/scene';
import type { PhotoTestSeed } from '../calibration/photo-test-card-draft';
import { usePhotoTestLibrary, type PhotoTestResult } from '../calibration/photo-test-library';
import type { ToneCalibrationSeed } from '../calibration/tone-calibration-draft';
import type { PhotoEngravingApply } from './photo-engraving-apply';
import type { PhotoEngravingSession } from './photo-engraving-store';
import PhotoEngravingDialog from './PhotoEngravingDialog';

vi.mock('./use-photo-engraving-preview', () => ({ usePhotoEngravingPreview: () => null }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SLATE_CURVE = fitPhotoToneCurve([{ commandedPercent: 50, observedPercent: 70 }], 'Slate');

const SLATE: PhotoTestResult = {
  id: 'slate',
  label: 'Black slate · 60% · 2000 mm/min',
  power: 60,
  speed: 2000,
  savedAt: '2026-11-13T00:00:00.000Z',
  processing: { ditherAlgorithm: 'blue-noise', linesPerMm: 10, negativeImage: true },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  usePhotoTestLibrary.setState({ results: [] });
});

/** A Blue Noise, light-marks photo on a 40% operation; its 50% multiplier burns it at 20%. */
function session(): PhotoEngravingSession {
  const operation: Layer = {
    ...createLayer({ id: 'photo', color: '#808080', mode: 'image' }),
    ditherAlgorithm: 'blue-noise',
    linesPerMm: 10,
    negativeImage: true,
    power: 40,
    speed: 2400,
  };
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'portrait',
    source: 'portrait.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: btoa(String.fromCharCode(0, 96, 255, 255, 96, 0)),
    pixelWidth: 3,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 3, maxY: 2 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'blue-noise',
    linesPerMm: 10,
    operationIds: ['photo'],
    powerScale: 50,
    brightness: 6,
    contrast: 13,
    gamma: 0.64,
    sharpenAmount: 30,
    sharpenRadius: 0.7,
    operationOverride: { photoToneCurve: SLATE_CURVE },
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

function handlersForRender() {
  return {
    onApply: vi.fn<(patch: PhotoEngravingApply) => void>(),
    onBurnTestCard: vi.fn<(seed: PhotoTestSeed, patch: PhotoEngravingApply) => void>(),
    onCalibrateTones: vi.fn<(seed: ToneCalibrationSeed) => void>(),
  };
}

type Handlers = ReturnType<typeof handlersForRender>;

async function render(): Promise<Handlers> {
  const handlers = handlersForRender();
  await act(async () => {
    root.render(
      <PhotoEngravingDialog
        session={session()}
        current
        error={null}
        onCancel={vi.fn()}
        onEditSource={vi.fn()}
        {...handlers}
      />,
    );
  });
  return handlers;
}

function tested(): HTMLSelectElement {
  const select = document.body.querySelector('select[aria-label="Tested power and speed"]');
  if (!(select instanceof HTMLSelectElement)) throw new Error('Tested power and speed missing');
  return select;
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value;
    Simulate.change(select);
  });
}

async function press(label: string): Promise<void> {
  const button = [...document.body.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${label} missing`);
  await act(async () => button.click());
}

async function apply(): Promise<void> {
  const form = document.body.querySelector('form');
  if (form === null) throw new Error('form missing');
  await act(async () => Simulate.submit(form));
}

describe('Photo engraving tested power and speed (ADR-711)', () => {
  it("keeps the operation's power and speed until a tested one is chosen", async () => {
    usePhotoTestLibrary.setState({ results: [SLATE] });
    const { onApply } = await render();
    expect(tested().value).toBe('keep');
    // 40% x the photo's 50% multiplier.
    expect(tested().options[0]?.textContent).toBe('Keep the current (20% · 2400 mm/min)');
    expect(tested().options[1]?.textContent).toBe('Black slate · 60% · 2000 mm/min');
    await apply();
    const layerPatch = onApply.mock.calls[0]?.[0].layerPatch;
    expect(layerPatch).toMatchObject({ ditherAlgorithm: 'blue-noise', negativeImage: true });
    expect(layerPatch).not.toHaveProperty('power');
    expect(layerPatch).not.toHaveProperty('speed');
  });

  it('applies the chosen tested power and speed to the photo', async () => {
    usePhotoTestLibrary.setState({ results: [SLATE] });
    const { onApply } = await render();
    await choose(tested(), 'slate');
    expect(tested().value).toBe('slate');
    expect(document.body.textContent).toContain('for this photo only');
    expect(document.body.textContent).not.toContain('burned with a different');
    await apply();
    expect(onApply.mock.calls[0]?.[0].layerPatch).toMatchObject({ power: 60, speed: 2000 });
  });

  it('says when the card was burned with other photo settings', async () => {
    usePhotoTestLibrary.setState({
      results: [{ ...SLATE, processing: { ...SLATE.processing, linesPerMm: 12 } }],
    });
    await render();
    await choose(tested(), 'slate');
    expect(document.body.textContent).toContain('That card was burned with a different DPI.');
  });

  it('measures a tone calibration against the tested power and speed', async () => {
    usePhotoTestLibrary.setState({ results: [SLATE] });
    const { onCalibrateTones } = await render();
    await choose(tested(), 'slate');
    await press('Calibrate a material');
    expect(onCalibrateTones).toHaveBeenCalledWith(
      expect.objectContaining({ settings: expect.objectContaining({ power: 60, speed: 2000 }) }),
    );
  });

  it('makes a test card from the photo as this window has it', async () => {
    const { onBurnTestCard } = await render();
    await press('Burn a test card');
    const seed = onBurnTestCard.mock.calls[0]?.[0];
    expect(seed).toMatchObject({
      sourceName: 'portrait.png',
      tones: { brightness: 6, contrast: 13, gamma: 0.64, sharpenAmount: 30, sharpenRadius: 0.7 },
      settings: {
        mode: 'image',
        ditherAlgorithm: 'blue-noise',
        linesPerMm: 10,
        negativeImage: true,
        passThrough: false,
        // The power the photo burns with: its multiplier applied.
        power: 20,
        speed: 2400,
        photoToneCurve: SLATE_CURVE,
      },
    });
    expect(seed?.image.id).toBe('portrait');
    // The window's settings go onto the photo before the card replaces the project.
    expect(onBurnTestCard.mock.calls[0]?.[1]).toMatchObject({
      imagePatch: { brightness: 6, contrast: 13, gamma: 0.64, sharpenAmount: 30 },
      layerPatch: { ditherAlgorithm: 'blue-noise', negativeImage: true, passThrough: false },
    });
  });

  it('leaves a tone calibration off the card when the window has none chosen', async () => {
    const { onBurnTestCard } = await render();
    const curve = document.body.querySelector('select[aria-label="Tone calibration"]');
    if (!(curve instanceof HTMLSelectElement)) throw new Error('Tone calibration missing');
    await choose(curve, 'none');
    await press('Burn a test card');
    expect(onBurnTestCard.mock.calls[0]?.[0].settings).toMatchObject({ mode: 'image' });
    expect(onBurnTestCard.mock.calls[0]?.[0].settings).not.toHaveProperty('photoToneCurve');
  });
});
