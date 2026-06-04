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

function overBudgetRasterProject(): Project {
  const color = '#808080';
  const raster: RasterImage = {
    kind: 'raster-image',
    id: 'huge-image',
    source: 'huge.png',
    dataUrl: 'data:image/png;base64,',
    pixelWidth: 10,
    pixelHeight: 10,
    bounds: { minX: 0, minY: 0, maxX: 300, maxY: 300 },
    transform: IDENTITY_TRANSFORM,
    color,
    dither: 'floyd-steinberg',
    linesPerMm: 25,
    lumaBase64: '',
  };
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [raster],
      layers: [
        {
          ...createLayer({ id: 'image-layer', color, mode: 'image' }),
          linesPerMm: 25,
          power: 10,
        },
      ],
    },
  };
}

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({
    streamer: null,
    workOriginActive: false,
    wcoCache: null,
  });
  useToastStore.setState({ toasts: [] });
  vi.clearAllMocks();
});

describe('custom-origin raster budget guard', () => {
  it('blocks custom-origin Start before compileJob can touch an over-budget raster', () => {
    const result = prepareStartJob(overBudgetRasterProject(), readyController, readyMachine);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages.join('\n')).toContain('image would engrave at 7500x7500 px');
    }
  });

  it('blocks Frame before compileJob can touch an over-budget raster', async () => {
    useStore.setState({ project: overBudgetRasterProject() });
    const originalFrame = useLaserStore.getState().frame;
    const frame = vi.fn(async () => undefined);
    useLaserStore.setState({
      frame,
      streamer: null,
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
        (button) => button.textContent === 'Frame',
      );
      if (frameButton === undefined) throw new Error('Frame button not rendered');

      await act(async () => {
        frameButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(frame).not.toHaveBeenCalled();
      expect(useToastStore.getState().toasts.at(-1)?.message).toContain(
        'image would engrave at 7500x7500 px',
      );
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      useLaserStore.setState({ frame: originalFrame });
      host.remove();
    }
  });
});
