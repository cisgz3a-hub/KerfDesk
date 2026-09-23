import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer } from '../../core/controllers/grbl';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useUiStore } from '../state/ui-store';
import {
  idleControllerStatusForFrameTest,
  installReviewPendingFramedRunPermitForCurrentState,
} from './framed-run-testing';
import { LaserWindow } from './LaserWindow';
import type * as StartJobFlow from './start-job-flow';
import { useStartBlockerStore } from './start-blocker-store';
import { WorkspaceJobActions } from './WorkspaceJobActions';

const calls = vi.hoisted(() => ({ frame: vi.fn(), start: vi.fn(), estimate: vi.fn() }));

vi.mock('./use-frame-action', () => ({ useFrameAction: () => calls.frame }));
vi.mock('./use-job-estimate', () => ({
  useJobEstimate: () => {
    calls.estimate();
    return { kind: 'empty' };
  },
}));
vi.mock('./start-job-flow', async (importOriginal) => ({
  ...(await importOriginal<typeof StartJobFlow>()),
  runStartJobFlow: calls.start,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};
let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
  useUiStore.getState().setRailPanelVisible('machine', true);
  useStartBlockerStore.getState().clear();
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  root = null;
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
  useStartBlockerStore.getState().clear();
});

describe('Workspace job dock', () => {
  it('routes Frame and setup-and-Frame to the existing independent handlers', () => {
    connectIdle();
    render(<WorkspaceJobActions />);

    act(() => button('Frame job').click());
    expect(calls.frame).toHaveBeenCalledOnce();
    expect(calls.start).not.toHaveBeenCalled();

    act(() => button('Set up & Frame').click());
    expect(calls.start).toHaveBeenCalledOnce();
    expect(calls.frame).toHaveBeenCalledOnce();
  });

  it('preserves disconnected and missing-Idle button states without adding a Start policy gate', () => {
    render(<WorkspaceJobActions />);
    expect(button('Frame job').disabled).toBe(true);
    expect(button('Set up & Frame').disabled).toBe(true);

    act(() => useLaserStore.setState({ connection: { kind: 'connected' } }));
    expect(button('Frame job').disabled).toBe(true);
    expect(button('Frame job').title).toContain('Wait for an Idle');
    expect(button('Set up & Frame').disabled).toBe(false);

    act(() => useLaserStore.setState({ statusReport: idleControllerStatusForFrameTest() }));
    expect(button('Frame job').disabled).toBe(false);
  });

  it.each(['streaming', 'paused', 'tool-change', 'errored', 'done'] as const)(
    'preserves the busy boundary for a %s job',
    (status) => {
      connectIdle();
      useLaserStore.setState({ streamer: { ...createStreamer('G1 X1 S100'), status } });
      render(<WorkspaceJobActions />);

      expect(button('Frame job').disabled).toBe(true);
      expect(button('Set up & Frame').disabled).toBe(true);
      expect(labels()).not.toContain('Pause');
      expect(labels()).not.toContain('ABORT JOB');
    },
  );

  it('keeps both actions unavailable throughout autofocus, controller work, and active Frame', () => {
    connectIdle();
    useLaserStore.setState({ autofocusBusy: true });
    render(<WorkspaceJobActions />);
    expectActionsDisabled();

    act(() =>
      useLaserStore.setState({
        autofocusBusy: false,
        controllerOperation: { kind: 'connection-handshake', phase: 'settings' },
      }),
    );
    expectActionsDisabled();

    act(() =>
      useLaserStore.setState({
        controllerOperation: null,
        motionOperation: {
          operationId: 1,
          kind: 'frame',
          sawControllerBusy: false,
          idleStatusReports: 0,
          dispatchComplete: false,
          pendingLines: [],
        },
      }),
    );
    expectActionsDisabled();
    expect(host.textContent).toContain('Framing exact job');
  });

  it('uses exact permit readiness and updates immediately when placement invalidates it', async () => {
    installArtwork();
    connectIdle();
    await installReviewPendingFramedRunPermitForCurrentState();
    render(<WorkspaceJobActions />);

    expect(button('Start framed job').disabled).toBe(false);
    expect(button('Frame again').disabled).toBe(false);
    expect(host.textContent).toContain('Ready to start — framed job unchanged');
    act(() => button('Start framed job').click());
    expect(calls.start).toHaveBeenCalledOnce();

    act(() => useStore.getState().setJobPlacement({ startFrom: 'current-position' }));
    expect(labels()).not.toContain('Start framed job');
    expect(button('Set up & Frame').disabled).toBe(false);
    expect(host.textContent).toContain('Frame expired');
  });

  it('mounts one estimator and action pair while preserving setup, placement, recovery, and console', () => {
    useStartBlockerStore.getState().report(['Wait for the controller to reconnect.']);
    render(
      <>
        <LaserWindow dockedJobActions />
        <WorkspaceJobActions />
      </>,
    );

    expect(labels().filter((label) => label === 'Frame job')).toHaveLength(1);
    expect(labels().filter((label) => label === 'Set up & Frame')).toHaveLength(1);
    expect(calls.estimate).toHaveBeenCalledOnce();
    expect(labels()).toEqual(
      expect.arrayContaining([
        'Set origin here',
        'Reset origin',
        'Set up homing',
        'Set up auto-focus',
        'Resume from line',
      ]),
    );
    expect(host.querySelector('[aria-label="Start from"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Selected artwork only"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Execution archive"]')).not.toBeNull();
    // The docked console itself mounts only while its section is open.
    expect(
      [...host.querySelectorAll('summary')].some((summary) => summary.textContent === 'Console'),
    ).toBe(true);
    const dock = host.querySelector('[aria-label="Job actions"]');
    expect(dock?.textContent).toContain('Wait for the controller to reconnect.');
    expect(host.querySelector('aside')?.textContent).not.toContain('Last Start attempt blocked');
    const placement = [...host.querySelectorAll('summary')].find(
      (summary) => summary.textContent === 'Placement & output',
    )?.parentElement;
    expect(placement).toBeInstanceOf(HTMLDetailsElement);
    expect((placement as HTMLDetailsElement).open).toBe(false);
  });

  it('keeps inline Frame and Start actions in a standalone machine panel by default', () => {
    render(<LaserWindow />);

    expect(labels()).toContain('Frame job');
    expect(labels()).toContain('Set up & Frame');
    expect(calls.estimate).toHaveBeenCalledOnce();
    expect(host.querySelector('[aria-label="Job actions"]')).toBeNull();
  });
});

function connectIdle(): void {
  useLaserStore.setState({
    connection: { kind: 'connected' },
    statusReport: idleControllerStatusForFrameTest(),
    activeWcs: 'G54',
  });
}

function installArtwork(): void {
  useStore.setState({
    jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
    project: {
      ...createProject(),
      scene: {
        ...EMPTY_SCENE,
        layers: [createLayer({ id: 'red', color: '#ff0000' })],
        objects: [
          {
            kind: 'imported-svg',
            id: 'line',
            source: 'line.svg',
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#ff0000',
                polylines: [
                  {
                    closed: false,
                    points: [
                      { x: 0, y: 0 },
                      { x: 10, y: 10 },
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

function render(children: ReactNode): void {
  act(() => root?.render(<PlatformProvider adapter={platform}>{children}</PlatformProvider>));
}

function button(label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  if (match === undefined) throw new Error(`Missing button: ${label}`);
  return match;
}

function labels(): string[] {
  return [...host.querySelectorAll('button')].map((item) => item.textContent ?? '');
}

function expectActionsDisabled(): void {
  expect(button('Frame job').disabled).toBe(true);
  expect(button('Set up & Frame').disabled).toBe(true);
}
