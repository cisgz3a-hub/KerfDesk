import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { effectiveOperationForObject } from '../../core/effective-output';
import { fitPhotoToneCurve } from '../../core/raster/photo-tone-curve';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type DitherAlgorithm,
  type Layer,
  type RasterImage,
} from '../../core/scene';
import {
  useToneCalibrationLibrary,
  type ToneCalibrationRecord,
} from '../calibration/tone-calibration-library';
import { photoEngravingImage, type PhotoEngravingApply } from './photo-engraving-apply';
import type { PhotoEngravingSession } from './photo-engraving-store';
import PhotoEngravingDialog from './PhotoEngravingDialog';

// Rolling audit v4 H5-P2-3 (ADR-670 Amendment 2): a Grayscale tone
// calibration could be burned and recorded, but Photo engraving opened a
// Grayscale photo as Jarvis and Apply wrote Jarvis with the Grayscale curve.

vi.mock('./use-photo-engraving-preview', () => ({ usePhotoEngravingPreview: () => null }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const MAPLE = fitPhotoToneCurve([{ commandedPercent: 50, observedPercent: 75 }], 'Maple grayscale');
const MISMATCH = 'measured with a different';

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
  useToneCalibrationLibrary.setState({ records: [] });
});

function session(ditherAlgorithm: DitherAlgorithm): PhotoEngravingSession {
  const operation: Layer = {
    ...createLayer({ id: 'photo', color: '#808080', mode: 'image' }),
    ditherAlgorithm,
    linesPerMm: 2,
    power: 60,
    minPower: 10,
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
    dither: ditherAlgorithm,
    linesPerMm: 2,
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

const GRAYSCALE_WEDGE: ToneCalibrationRecord = {
  id: 'maple-grayscale',
  curve: MAPLE,
  savedAt: '2026-10-27T00:00:00.000Z',
  settings: {
    ditherAlgorithm: 'grayscale',
    linesPerMm: 2,
    power: 60,
    speed: 2400,
    negativeImage: false,
  },
  samples: [{ commandedPercent: 50, observedPercent: 75 }],
};

async function render(
  current: PhotoEngravingSession,
  onApply: (patch: PhotoEngravingApply) => void = vi.fn(),
): Promise<void> {
  await act(async () => {
    root.render(
      <PhotoEngravingDialog
        session={current}
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

function processing(value: string): HTMLInputElement | null {
  return document.body.querySelector<HTMLInputElement>(
    `[role="radiogroup"][aria-label="Photo processing"] input[value="${value}"]`,
  );
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

describe('Photo engraving keeps Grayscale (ADR-670 Amendment 2)', () => {
  it('opens a Grayscale photo on Grayscale and still offers it after another is picked', async () => {
    await render(session('grayscale'));
    expect(processing('grayscale')?.checked).toBe(true);

    await act(async () => processing('jarvis')?.click());

    expect(processing('jarvis')?.checked).toBe(true);
    expect(processing('grayscale')).not.toBeNull();
  });

  it('applies a Grayscale calibration to a Grayscale photo as it was measured', async () => {
    useToneCalibrationLibrary.setState({ records: [GRAYSCALE_WEDGE] });
    const onApply = vi.fn<(patch: PhotoEngravingApply) => void>();
    const current = session('grayscale');
    await render(current, onApply);

    await choose('Tone calibration', 'Maple grayscale');
    expect(document.body.textContent).not.toContain(MISMATCH);
    const form = document.body.querySelector('form');
    await act(async () => form?.requestSubmit());

    const patch = onApply.mock.calls[0]?.[0];
    expect(patch?.layerPatch).toMatchObject({
      ditherAlgorithm: 'grayscale',
      photoToneCurve: MAPLE,
    });
    if (patch === undefined) throw new Error('Apply was not called');
    const burned = effectiveOperationForObject(
      current.operation,
      photoEngravingImage(current.image, current.operation, patch),
    );
    expect(burned).toMatchObject({ ditherAlgorithm: 'grayscale', photoToneCurve: MAPLE });
  });

  it('does not offer Grayscale for a photo burned with a dither', async () => {
    await render(session('stucki'));
    expect(processing('stucki')?.checked).toBe(true);
    expect(processing('grayscale')).toBeNull();
  });
});
