import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureLayerOperationSettings,
  IDENTITY_TRANSFORM,
  LAYER_DEFAULTS,
  type RasterImage,
} from '../../core/scene';
import {
  LAST_PHOTO_TEST_CARD_KEY,
  PHOTO_TEST_CARD_DRAFT_KEY,
  writeLastPhotoTestCard,
  type PhotoTestSeed,
} from './photo-test-card-draft';
import { PhotoTestCardDialog } from './PhotoTestCardDialog';
import { photoTestEdgeHints } from './PhotoTestPickStep';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const WIDTH = 240;
const HEIGHT = 160;

/** A 240 x 160 px photo placed at 120 x 80 mm (2 px/mm), mirrored left to right. */
const IMAGE: RasterImage = {
  kind: 'raster-image',
  id: 'portrait',
  source: 'portrait.png',
  pixelWidth: WIDTH,
  pixelHeight: HEIGHT,
  bounds: { minX: 0, minY: 0, maxX: 60, maxY: 40 },
  transform: { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 2, mirrorX: true },
  color: '#808080',
  dither: 'blue-noise',
  linesPerMm: 10,
};

const SEED: PhotoTestSeed = {
  sourceName: 'portrait.png',
  image: IMAGE,
  settings: {
    ...captureLayerOperationSettings({ ...LAYER_DEFAULTS, mode: 'image' }),
    ditherAlgorithm: 'blue-noise',
    linesPerMm: 10,
    power: 40,
    speed: 3000,
    negativeImage: true,
    dotWidthCorrectionMm: 0.03,
  },
  tones: { brightness: 6, contrast: 13, gamma: 0.64, sharpenAmount: 30, sharpenRadius: 0.7 },
};

/** Column index as the grey, so a crop shows where it came from. */
function luma(): Uint8Array {
  const pixels = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) pixels.fill(0, y * WIDTH, (y + 1) * WIDTH);
  for (let index = 0; index < pixels.length; index += 1) pixels[index] = index % WIDTH;
  return pixels;
}

type Rendered = {
  readonly host: HTMLDivElement;
  readonly root: Root;
  readonly onGenerate: ReturnType<typeof vi.fn>;
  readonly onSave: ReturnType<typeof vi.fn>;
};

async function render(
  step: 'generate' | 'pick',
  seed: PhotoTestSeed | null = SEED,
  readLuma: () => Promise<Uint8Array> = () => Promise.resolve(luma()),
): Promise<Rendered> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onGenerate = vi.fn();
  const onSave = vi.fn();
  await act(async () => {
    root.render(
      <PhotoTestCardDialog
        initialStep={step}
        seed={seed}
        maxFeedMmPerMin={4000}
        readLuma={readLuma}
        onClose={vi.fn()}
        onGenerate={onGenerate}
        onSave={onSave}
      />,
    );
  });
  return { host, root, onGenerate, onSave };
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`${label} missing`);
  return found;
}

function field(host: HTMLElement, label: string): HTMLInputElement {
  const found = host.querySelector(`input[aria-label="${label}"]`);
  if (!(found instanceof HTMLInputElement)) throw new Error(`${label} missing`);
  return found;
}

async function type(host: HTMLElement, label: string, value: string): Promise<void> {
  await act(async () => {
    const input = field(host, label);
    input.value = value;
    Simulate.change(input);
  });
}

async function submit(host: HTMLElement): Promise<void> {
  const form = host.querySelector('form');
  if (form === null) throw new Error('form missing');
  await act(async () => Simulate.submit(form));
}

afterEach(() => {
  localStorage.removeItem(LAST_PHOTO_TEST_CARD_KEY);
  localStorage.removeItem(PHOTO_TEST_CARD_DRAFT_KEY);
  document.body.innerHTML = '';
});

describe('PhotoTestCardDialog: burn the card', () => {
  it('centres the card on the photo power and speed, inside the machine top feed', async () => {
    const { host, root } = await render('generate');
    try {
      expect(host.textContent).toContain('Squares cut from portrait.png');
      expect(host.textContent).toContain('Blue Noise · 254 DPI · light marks');
      expect(field(host, 'Lowest power (%)').value).toBe('20');
      expect(field(host, 'Highest power (%)').value).toBe('60');
      expect(field(host, 'Slowest speed (mm/min)').value).toBe('1500');
      // 3000 x 1.5 is 4500, above this machine's 4000.
      expect(field(host, 'Fastest speed (mm/min)').value).toBe('4000');
      expect(host.querySelector('[aria-label="Card summary"]')?.textContent).toContain(
        '12 squares of 15 × 15 mm. Power across: 20, 33.33, 46.67, 60 %. Speed down: 4000, 2750, 1500 mm/min.',
      );
    } finally {
      act(() => root.unmount());
    }
  });

  it('generates squares cut from the photo at its scale, with its settings and tones', async () => {
    const { host, root, onGenerate } = await render('generate');
    try {
      await type(host, 'Across the photo (%)', '25');
      await type(host, 'Down the photo (%)', '50');
      await type(host, 'Square size (mm)', '10');
      await submit(host);
      const [options, seed] = onGenerate.mock.calls[0] ?? [];
      expect(seed).toBe(SEED);
      expect(options).toMatchObject({
        rows: 3,
        columns: 4,
        powerMin: 20,
        powerMax: 60,
        speedMin: 1500,
        speedMax: 4000,
        maxFeedMmPerMin: 4000,
        tones: SEED.tones,
        operation: {
          mode: 'image',
          ditherAlgorithm: 'blue-noise',
          linesPerMm: 10,
          negativeImage: true,
          dotWidthCorrectionMm: 0.03,
          passThrough: false,
          power: 40,
          speed: 3000,
        },
      });
      // 10 mm at 2 px/mm is 20 stored pixels, centred a quarter of the way across.
      expect(options.patch).toMatchObject({
        pixelWidth: 20,
        pixelHeight: 20,
        widthMm: 10,
        heightMm: 10,
      });
      // Columns 50..69 of the photo, mirrored as the placed photo is.
      expect(options.patch.luma[0]).toBe(69);
      expect(options.patch.luma[19]).toBe(50);
      expect(localStorage.getItem(PHOTO_TEST_CARD_DRAFT_KEY)).toContain('"cellSizeMm":"10"');
    } finally {
      act(() => root.unmount());
    }
  });

  it('moves the piece where the photo is clicked', async () => {
    const { host, root } = await render('generate');
    try {
      const picker = host.querySelector('button[aria-label="Photo piece to burn"]');
      if (!(picker instanceof HTMLButtonElement)) throw new Error('picker missing');
      picker.getBoundingClientRect = () =>
        ({ left: 100, top: 50, width: 260, height: 173 }) as DOMRect;
      await act(async () =>
        Simulate.click(picker, { clientX: 100 + 65, clientY: 50 + 130, detail: 1 }),
      );
      expect(field(host, 'Across the photo (%)').value).toBe('25');
      expect(field(host, 'Down the photo (%)').value).toBe('75');
      // A keyboard press has no position and leaves the piece alone.
      await act(async () => Simulate.click(picker, { clientX: 0, clientY: 0, detail: 0 }));
      expect(field(host, 'Across the photo (%)').value).toBe('25');
    } finally {
      act(() => root.unmount());
    }
  });

  it('holds Generate while a field is wrong and says which', async () => {
    const { host, root, onGenerate } = await render('generate');
    try {
      await type(host, 'Highest power (%)', '140');
      expect(button(host, 'Generate card').disabled).toBe(true);
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(
        'Highest power: enter 100 or less.',
      );
      await submit(host);
      expect(onGenerate).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
    }
  });

  it('asks for a photo when none is selected', async () => {
    const { host, root, onGenerate } = await render('generate', null);
    try {
      expect(host.textContent).toContain('Select one photo on the canvas');
      expect(button(host, 'Generate card').disabled).toBe(true);
      expect(host.querySelector('[role="alert"]')).toBeNull();
      await submit(host);
      expect(onGenerate).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
    }
  });

  it('refuses a photo with more pixels than one read may hold, without reading it', async () => {
    const readLuma = vi.fn(() => Promise.resolve(luma()));
    const huge = { ...SEED, image: { ...IMAGE, pixelWidth: 10_000, pixelHeight: 6000 } };
    const { host, root } = await render('generate', huge, readLuma);
    try {
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('too big');
      expect(button(host, 'Generate card').disabled).toBe(true);
      expect(readLuma).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
    }
  });

  it('refuses a photo whose pixels cannot be read', async () => {
    const { host, root, onGenerate } = await render('generate', SEED, () =>
      Promise.reject(new Error('gone')),
    );
    try {
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        'could not read this photo’s pixels',
      );
      expect(button(host, 'Generate card').disabled).toBe(true);
      await submit(host);
      expect(onGenerate).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
    }
  });
});

describe('PhotoTestCardDialog: pick the best square', () => {
  const CARD = {
    sourceName: 'portrait.png',
    powers: [20, 40, 60, 80],
    speeds: [4000, 2750, 1500],
    processing: { ditherAlgorithm: 'blue-noise', linesPerMm: 10, negativeImage: true },
  } as const;

  it('says so when no card has been generated here', async () => {
    const { host, root, onSave } = await render('pick');
    try {
      expect(host.textContent).toContain('No test card has been generated on this computer yet');
      expect(button(host, 'Save power and speed').disabled).toBe(true);
      await submit(host);
      expect(onSave).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
    }
  });

  it('saves the picked square as a named power and speed', async () => {
    writeLastPhotoTestCard(CARD);
    const { host, root, onSave } = await render('pick', null);
    try {
      expect(host.textContent).toContain('Card cut from portrait.png');
      expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(12);
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(
        'Pick the best square. Name the material.',
      );
      await act(async () => Simulate.change(field(host, '60% power at 2750 mm/min')));
      expect(field(host, '60% power at 2750 mm/min').checked).toBe(true);
      expect(host.querySelector('[role="status"]')).toBeNull();
      expect(button(host, 'Save power and speed').disabled).toBe(true);
      await type(host, 'Tested material', 'Black slate');
      expect(button(host, 'Save power and speed').disabled).toBe(false);
      expect(host.querySelector('[role="alert"]')).toBeNull();
      await submit(host);
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave.mock.calls[0]?.[0]).toMatchObject({
        label: 'Black slate · 60% · 2750 mm/min',
        power: 60,
        speed: 2750,
        processing: CARD.processing,
      });
    } finally {
      act(() => root.unmount());
    }
  });

  it('points beyond the card when the best square is on its edge', async () => {
    writeLastPhotoTestCard(CARD);
    const { host, root } = await render('pick', null);
    try {
      await act(async () => Simulate.change(field(host, '80% power at 1500 mm/min')));
      expect(host.querySelector('[role="status"]')?.textContent).toContain(
        'burn another card with higher power and slower speeds',
      );
    } finally {
      act(() => root.unmount());
    }
    expect(photoTestEdgeHints(CARD, { row: 0, column: 0, material: '' })).toEqual([
      'lower power',
      'faster speeds',
    ]);
    // Full power has nothing above it, and a single row or column has no edge.
    const full = { ...CARD, powers: [70, 100], speeds: [3000] };
    expect(photoTestEdgeHints(full, { row: 0, column: 1, material: '' })).toEqual([]);
  });
});
