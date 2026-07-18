import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CoreJob from '../../core/job';
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

vi.mock('../../core/job', async (importOriginal) => {
  const actual = await importOriginal<typeof CoreJob>();
  return {
    ...actual,
    compileJob: vi.fn(() => {
      throw new Error('compileJob called before raster budget guard');
    }),
  };
});

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
      objects: [overBudgetRaster('huge-image', { minX: 0, minY: 0, maxX: 300, maxY: 300 })],
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
        overBudgetRaster('selected-image', { minX: 0, minY: 0, maxX: 300, maxY: 300 }),
        overBudgetRaster('unselected-image', { minX: 330, minY: 0, maxX: 390, maxY: 60 }),
      ],
      layers: [imageLayer(color)],
    },
  };
}

function overBudgetRaster(id: string, bounds: RasterImage['bounds']): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,',
    pixelWidth: 10,
    pixelHeight: 10,
    bounds,
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 25,
    lumaBase64: '',
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

describe('custom-origin raster budget guard', () => {
  it('blocks custom-origin Start before compileJob can touch an over-budget raster', () => {
    const result = prepareStartJob(
      overBudgetRasterProject(),
      readyController,
      readyMachine,
      userOriginPlacement,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages.join('\n')).toContain('image would engrave at 7500x7500 px');
    }
  });

  it('refuses Frame when the exact raster artifact cannot pass compile-integrity preparation', async () => {
    useStore.setState({
      project: overBudgetRasterProject(),
      jobPlacement: userOriginPlacement,
    });
    const originalFrame = useLaserStore.getState().frame;
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

      expect(frame).not.toHaveBeenCalled();
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        variant: 'error',
        message: expect.stringContaining('image would engrave at 7500x7500 px'),
      });
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      useLaserStore.setState({ frame: originalFrame });
      host.remove();
    }
  });

  it('refuses the selected-output Frame when that exact selected raster is over budget', async () => {
    useStore.setState({
      project: selectedOverBudgetRasterProject(),
      jobPlacement: userOriginPlacement,
      selectedObjectId: 'selected-image',
      additionalSelectedIds: new Set(),
      outputScopeSettings: { cutSelectedGraphics: true, useSelectionOrigin: false },
    });
    const originalFrame = useLaserStore.getState().frame;
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

      expect(frame).not.toHaveBeenCalled();
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        variant: 'error',
        message: expect.stringContaining('image would engrave at 7500x7500 px'),
      });
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      useLaserStore.setState({ frame: originalFrame });
      host.remove();
    }
  });

  it('does not use Falcon framing feed as an approximate fallback for an unbuildable raster', async () => {
    useStore.setState({
      project: {
        ...overBudgetRasterProject(),
        device: {
          ...overBudgetRasterProject().device,
          profileId: 'creality-falcon-a1-pro-grblhal',
          name: 'Creality Falcon A1 Pro (grblHAL)',
          maxFeed: 500,
          framingFeedMmPerMin: 10000,
        },
      },
      jobPlacement: userOriginPlacement,
    });
    const originalFrame = useLaserStore.getState().frame;
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

      expect(frame).not.toHaveBeenCalled();
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        variant: 'error',
        message: expect.stringContaining('image would engrave at 7500x7500 px'),
      });
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      useLaserStore.setState({ frame: originalFrame });
      host.remove();
    }
  });
});
