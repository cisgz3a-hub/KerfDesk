import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { JobControls } from './JobControls';
import { CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE } from './start-job-readiness';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function installProject(): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        ...EMPTY_SCENE,
        layers: [createLayer({ id: 'L1', color: '#ff0000' })],
        objects: [
          {
            kind: 'imported-svg',
            id: 'O1',
            source: 'a.svg',
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#ff0000',
                polylines: [
                  {
                    closed: true,
                    points: [
                      { x: 0, y: 0 },
                      { x: 10, y: 0 },
                      { x: 10, y: 10 },
                      { x: 0, y: 10 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  });
}

function installFillProjectAtLeftEdge(): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        ...EMPTY_SCENE,
        layers: [
          {
            ...createLayer({ id: 'L-fill', color: '#ff0000', mode: 'fill' }),
            fillOverscanMm: 5,
            hatchSpacingMm: 2,
            power: 10,
          },
        ],
        objects: [
          {
            kind: 'imported-svg',
            id: 'fill-edge',
            source: 'fill.svg',
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#ff0000',
                polylines: [
                  {
                    closed: true,
                    points: [
                      { x: 0, y: 0 },
                      { x: 10, y: 0 },
                      { x: 10, y: 10 },
                      { x: 0, y: 10 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  });
}

type MotionOperationSnapshot = {
  readonly kind: 'frame' | 'jog';
  readonly sawControllerBusy: boolean;
  readonly idleStatusReports?: number;
  readonly dispatchComplete?: boolean;
};

function setMotionOperation(operation: MotionOperationSnapshot | null): void {
  const normalized =
    operation === null ? null : { dispatchComplete: false, idleStatusReports: 0, ...operation };
  useLaserStore.setState({ motionOperation: normalized } as Partial<
    ReturnType<typeof useLaserStore.getState>
  >);
}

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({
    streamer: null,
    statusReport: null,
    workOriginActive: false,
    wcoCache: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  setMotionOperation(null);
  useToastStore.setState({ toasts: [] });
  vi.restoreAllMocks();
});

describe('JobControls Frame action', () => {
  it('blocks Frame when fill overscan would make Start fail out of bounds', async () => {
    installFillProjectAtLeftEdge();
    const originalFrame = useLaserStore.getState().frame;
    const frame = vi.fn(async () => undefined);
    useLaserStore.setState({
      frame,
      streamer: null,
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
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
      expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/overscan/i);
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      useLaserStore.setState({ frame: originalFrame });
      host.remove();
    }
  });

  it('blocks Frame when a custom origin is active but WCO is unknown', async () => {
    installProject();
    const originalFrame = useLaserStore.getState().frame;
    const frame = vi.fn(async () => undefined);
    useLaserStore.setState({
      frame,
      workOriginActive: true,
      wcoCache: null,
      streamer: null,
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
    });
    useStore.getState().setJobPlacement({ startFrom: 'user-origin' });
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
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        message: CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE,
        variant: 'error',
      });
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      useLaserStore.setState({ frame: originalFrame });
      host.remove();
    }
  });

  it('renders explicit Start From and 9-anchor Job Origin controls', async () => {
    installProject();
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<JobControls disabled={false} onStartJob={() => undefined} />);
      });

      const startFrom = host.querySelector('select[aria-label="Start from"]');
      expect(startFrom).not.toBeNull();
      expect([...host.querySelectorAll('button[aria-label^="Job origin"]')]).toHaveLength(9);
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });
});

describe('JobControls running safety copy', () => {
  it('warns that Pause is feed hold only and Stop or physical E-stop is the unsafe-condition path', async () => {
    installProject();
    useLaserStore.setState({
      streamer: {
        status: 'streaming',
        streamingMode: 'char-counted',
        queued: [],
        queueIndex: 0,
        inFlight: [{ line: 'G1 X10 Y10 S500\n', bytes: 16 }],
        inFlightBytes: 16,
        completed: 1,
        total: 5,
        rxBufferBytes: 120,
        toolChangePause: false,
      },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<JobControls disabled={false} onStartJob={() => undefined} />);
      });

      expect(host.textContent).toContain(
        'Pause is feed hold only. Use Stop or physical E-stop if unsafe.',
      );
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });

  it('keeps Stop visible after a controller error leaves the job in recovery', async () => {
    installProject();
    useLaserStore.setState({
      streamer: {
        status: 'errored',
        streamingMode: 'char-counted',
        queued: [],
        queueIndex: 0,
        inFlight: [],
        inFlightBytes: 0,
        completed: 2,
        total: 5,
        rxBufferBytes: 120,
        toolChangePause: false,
      },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<JobControls disabled={false} onStartJob={() => undefined} />);
      });

      const buttons = [...host.querySelectorAll('button')].map((button) => button.textContent);
      expect(buttons).toContain('Stop');
      expect(buttons).not.toContain('Pause');
      expect(buttons).not.toContain('Resume');
      const buttonByText = (text: string): HTMLButtonElement => {
        const button = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
        if (button === undefined) throw new Error(`${text} button not rendered`);
        return button;
      };
      expect(buttonByText('Home').disabled).toBe(true);
      expect(buttonByText('Set origin here').disabled).toBe(true);
      expect(buttonByText('Frame').disabled).toBe(true);
      expect(buttonByText('Start job').disabled).toBe(true);
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });

  it('keeps a Stop escape mounted after a job finishes but before GRBL confirms Idle', async () => {
    installProject();
    useLaserStore.setState({
      streamer: {
        status: 'done',
        streamingMode: 'char-counted',
        queued: [],
        queueIndex: 0,
        inFlight: [],
        inFlightBytes: 0,
        completed: 5,
        total: 5,
        rxBufferBytes: 120,
        toolChangePause: false,
      },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<JobControls disabled={false} onStartJob={() => undefined} />);
      });

      const buttons = [...host.querySelectorAll('button')].map((button) => button.textContent);
      expect(buttons).toContain('Stop');
      expect(buttons).not.toContain('Pause');
      expect(buttons).not.toContain('Resume');
      const buttonByText = (text: string): HTMLButtonElement => {
        const button = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
        if (button === undefined) throw new Error(`${text} button not rendered`);
        return button;
      };
      expect(buttonByText('Home').disabled).toBe(true);
      expect(buttonByText('Set origin here').disabled).toBe(true);
      expect(buttonByText('Frame').disabled).toBe(true);
      expect(buttonByText('Start job').disabled).toBe(true);
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });

  it('shows Cancel frame and disables conflicting controls while Frame is active', async () => {
    installProject();
    setMotionOperation({ kind: 'frame', sawControllerBusy: false });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<JobControls disabled={false} onStartJob={() => undefined} />);
      });

      const buttonByText = (text: string): HTMLButtonElement => {
        const button = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
        if (button === undefined) throw new Error(`${text} button not rendered`);
        return button;
      };
      expect(buttonByText('Cancel frame').disabled).toBe(false);
      expect(buttonByText('Home').disabled).toBe(true);
      expect(buttonByText('Set origin here').disabled).toBe(true);
      expect(buttonByText('Frame').disabled).toBe(true);
      expect(buttonByText('Start job').disabled).toBe(true);
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });
});
