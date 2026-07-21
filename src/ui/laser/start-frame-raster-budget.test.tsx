// Over-budget rasters compile and reach the frame-first gate (ADR-243).
// This file previously pinned the raster-budget REFUSAL (ADR-230 point 7):
// Frame and Start were blocked before compileJob could touch an over-budget
// raster. That refusal was a policy cap (rule 7 / ADR-228); with row
// streaming the exact artifact IS producible for any pixel size, so the same
// scenarios now prove the opposite contract: compile runs, Start preparation
// succeeds, and Frame proceeds for the exact over-budget raster.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { prepareStartJob } from './start-job-readiness';
import { JobControls } from './JobControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const idleStatus = {
  state: 'Idle' as const,
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

const readyController = {
  maxPowerS: 1000,
  minPowerS: 0,
  laserModeEnabled: true,
};

const readyMachine = {
  statusReport: idleStatus,
  alarmCode: null,
  hasActiveStreamer: false,
  workOriginActive: true,
  wcoCache: { x: 100, y: 100, z: 0 },
};

const userOriginPlacement = {
  startFrom: 'user-origin' as const,
  anchor: 'front-left' as const,
};

function overBudgetRasterProject(): Project {
  const color = '#808080';
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [overBudgetRaster('huge-image', { minX: 0, minY: 0, maxX: 120, maxY: 120 })],
      layers: [imageLayer(color)],
    },
  };
}

function selectedOverBudgetRasterProject(): Project {
  const color = '#808080';
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [
        overBudgetRaster('selected-image', { minX: 0, minY: 0, maxX: 120, maxY: 120 }),
        overBudgetRaster('unselected-image', { minX: 330, minY: 0, maxX: 390, maxY: 60 }),
      ],
      layers: [imageLayer(color)],
    },
  };
}

// 120mm x 25 lines/mm = 3000x3000 px: the error-diffusion working set
// (9M px * 9 B + source) is over the former 64 MB refusal budget. The source
// is white except one center pixel, so the program has real motion (never
// 'empty-output') while streamed scans skip almost every row and stay fast.
const SOURCE_LUMA = ((): Buffer => {
  const luma = Buffer.alloc(100, 255);
  luma[55] = 0;
  return luma;
})();

function overBudgetRaster(id: string, bounds: RasterImage['bounds']): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,unused',
    pixelWidth: 10,
    pixelHeight: 10,
    bounds,
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 25,
    lumaBase64: SOURCE_LUMA.toString('base64'),
  };
}

function imageLayer(color: string): ReturnType<typeof createLayer> {
  return {
    ...createLayer({ id: 'image-layer', color, mode: 'image' }),
    linesPerMm: 25,
    power: 10,
  };
}

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    streamer: null,
    statusReport: null,
    activeWcs: null,
    workOriginActive: false,
    wcoCache: null,
  });
  useToastStore.setState({ toasts: [] });
  vi.clearAllMocks();
});

async function clickFrameJob(project: Project): Promise<ReturnType<typeof vi.fn>> {
  useStore.setState({ project, jobPlacement: userOriginPlacement });
  const frame = vi.fn(async () => undefined);
  useLaserStore.setState({
    frame,
    connection: { kind: 'connected' },
    streamer: null,
    statusReport: idleStatus,
    activeWcs: 'G54',
    workOriginActive: true,
    wcoCache: { x: 100, y: 100, z: 0 },
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  try {
    await act(async () => {
      root = createRoot(host);
      root.render(<JobControls disabled={false} onStartJob={() => undefined} />);
    });
    const frameButton = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Frame job',
    );
    if (frameButton === undefined) throw new Error('Frame job button not rendered');
    await act(async () => {
      frameButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  } finally {
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    host.remove();
  }
  return frame;
}

const LARGE_RASTER_TEST_TIMEOUT_MS = 30_000;

describe('over-budget rasters compile and frame (ADR-243)', () => {
  it(
    'prepares custom-origin Start for an over-budget raster once framed is waived',
    () => {
      const result = prepareStartJob(
        overBudgetRasterProject(),
        readyController,
        readyMachine,
        userOriginPlacement,
        undefined,
        undefined,
        undefined,
        false,
      );

      if (!result.ok) throw new Error(`refused: ${result.messages.join(' | ')}`);
      expect(result.gcode.length).toBeGreaterThan(0);
    },
    LARGE_RASTER_TEST_TIMEOUT_MS,
  );

  it(
    'refuses default Start only for the missing Frame, never for raster size',
    () => {
      const result = prepareStartJob(
        overBudgetRasterProject(),
        readyController,
        readyMachine,
        userOriginPlacement,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.messages.join('\n')).not.toContain('image would engrave');
        expect(result.messages.join('\n').toLowerCase()).toContain('frame');
      }
    },
    LARGE_RASTER_TEST_TIMEOUT_MS,
  );

  it(
    'frames the exact over-budget raster instead of refusing',
    async () => {
      const frame = await clickFrameJob(overBudgetRasterProject());

      // The stubbed frame() skips real dispatch bookkeeping, which yields its
      // own advisory toast; the pinned contract is only that no raster-size
      // refusal appears and framing is attempted.
      expect(frame).toHaveBeenCalled();
      for (const toast of useToastStore.getState().toasts) {
        expect(toast.message).not.toContain('image would engrave');
        expect(toast.message).not.toContain('budget');
      }
    },
    LARGE_RASTER_TEST_TIMEOUT_MS,
  );

  it(
    'frames the selected-output slice when that exact selected raster is over budget',
    async () => {
      useStore.setState({
        selectedObjectId: 'selected-image',
        additionalSelectedIds: new Set(),
        outputScopeSettings: { cutSelectedGraphics: true, useSelectionOrigin: false },
      });
      const frame = await clickFrameJob(selectedOverBudgetRasterProject());

      expect(frame).toHaveBeenCalled();
    },
    LARGE_RASTER_TEST_TIMEOUT_MS,
  );
});
