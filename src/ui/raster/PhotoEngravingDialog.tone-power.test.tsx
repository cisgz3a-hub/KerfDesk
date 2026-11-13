import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { fitPhotoToneCurve } from '../../core/raster/photo-tone-curve';
import { createLayer, IDENTITY_TRANSFORM, type Layer, type RasterImage } from '../../core/scene';
import {
  useToneCalibrationLibrary,
  type ToneCalibrationRecord,
} from '../calibration/tone-calibration-library';
import type { PhotoEngravingSession } from './photo-engraving-store';
import PhotoEngravingDialog from './PhotoEngravingDialog';

vi.mock('./use-photo-engraving-preview', () => ({ usePhotoEngravingPreview: () => null }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BIRCH = fitPhotoToneCurve([{ commandedPercent: 50, observedPercent: 80 }], 'Birch');
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

/** A 60% Jarvis operation; the photo's 25% multiplier burns it at 15%. */
function session(): PhotoEngravingSession {
  const operation: Layer = {
    ...createLayer({ id: 'photo', color: '#808080', mode: 'image' }),
    ditherAlgorithm: 'jarvis',
    linesPerMm: 10,
    power: 60,
    minPower: 20,
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
    dither: 'jarvis',
    linesPerMm: 10,
    operationIds: ['photo'],
    powerScale: 25,
    operationOverride: { photoToneCurve: BIRCH },
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

function birchMeasuredAt(power: number): ToneCalibrationRecord {
  return {
    id: `birch-${power}`,
    curve: BIRCH,
    savedAt: '2026-10-27T00:00:00.000Z',
    settings: {
      ditherAlgorithm: 'jarvis',
      linesPerMm: 10,
      power,
      speed: 2400,
      negativeImage: false,
    },
    samples: [{ commandedPercent: 50, observedPercent: 80 }],
  };
}

async function render(onCalibrateTones = vi.fn()): Promise<void> {
  await act(async () => {
    root.render(
      <PhotoEngravingDialog
        session={session()}
        current
        error={null}
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onEditSource={vi.fn()}
        onCalibrateTones={onCalibrateTones}
        onBurnTestCard={vi.fn()}
      />,
    );
  });
}

describe('Photo engraving tone calibration power (ADR-670 Amd 1, audit G1-P3-2)', () => {
  it("stays silent for a calibration measured at the photo's burn power", async () => {
    useToneCalibrationLibrary.setState({ records: [birchMeasuredAt(15)] });
    await render();
    expect(document.body.textContent).not.toContain(MISMATCH);
  });

  it("says so when the calibration was measured at the operation's unscaled power", async () => {
    useToneCalibrationLibrary.setState({ records: [birchMeasuredAt(60)] });
    await render();
    expect(document.body.textContent).toContain(`${MISMATCH} power.`);
  });

  it("seeds Calibrate a material with the photo's burn power and floor", async () => {
    const onCalibrateTones = vi.fn();
    await render(onCalibrateTones);
    const button = [...document.body.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes('Calibrate a material'),
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error('Calibrate a material missing');
    await act(async () => button.click());
    expect(onCalibrateTones).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceName: 'portrait.png',
        settings: expect.objectContaining({ power: 15, minPower: 5, speed: 2400 }),
      }),
    );
  });
});
