import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, onAck, pause, step } from '../../core/controllers/grbl';
import { NumericEditsBar } from '../commands/NumericEditsBar';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { JobControls } from './JobControls';
import { LiveMotionBar } from './LiveMotionBar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const realActions = {
  continueToolChange: useLaserStore.getState().continueToolChange,
  pauseJob: useLaserStore.getState().pauseJob,
  resumeJob: useLaserStore.getState().resumeJob,
  stopJob: useLaserStore.getState().stopJob,
};

function streamingStreamer(): NonNullable<ReturnType<typeof useLaserStore.getState>['streamer']> {
  return step(createStreamer('G1 X1 S100\nG1 X2 S100\nG1 X3 S100')).state;
}

function readyToolChangeStreamer() {
  let streamer = step(
    createStreamer('G1 X1 F600\nG0 Z5\nM5\nM0\nG0 Z5\nM3 S12000', {
      toolChangePause: true,
    }),
  ).state;
  while (streamer.inFlight.length > 0) streamer = onAck(streamer, 'ok').state;
  if (streamer.status !== 'tool-change') throw new Error('expected tool-change hold');
  return streamer;
}

async function render(node: JSX.Element): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((button) => button.textContent === text);
}

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({
    streamer: null,
    statusReport: null,
    controllerOperation: null,
    motionOperation: null,
    activeJobMachineKind: null,
    toolChangeIdleSeen: false,
    pendingToolLabel: null,
    pendingToolId: null,
    workZZeroEvidence: null,
    ...realActions,
  });
  document.body.innerHTML = '';
});

describe('LiveMotionBar', () => {
  it('owns the only visible Pause and Abort actions in the composed workspace', async () => {
    useLaserStore.setState({ streamer: streamingStreamer() });
    const { host, root } = await render(
      <>
        <NumericEditsBar />
        <LiveMotionBar />
        <JobControls disabled={false} onStartJob={() => undefined} />
      </>,
    );
    try {
      expect(buttonsByText(host, 'Pause')).toHaveLength(1);
      expect(buttonsByText(host, 'ABORT JOB')).toHaveLength(1);
      expect(buttonsByText(host, 'ABORT')).toHaveLength(0);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('shows large, explicit controls while streaming and wires the store actions', async () => {
    const pauseJob = vi.fn(async () => undefined);
    const stopJob = vi.fn(async () => undefined);
    useLaserStore.setState({ streamer: streamingStreamer(), pauseJob, stopJob });
    const { host, root } = await render(<LiveMotionBar />);
    try {
      const group = host.querySelector('[aria-label="Live machine controls"]');
      const pauseButton = buttonByText(host, 'Pause');
      const abortButton = buttonByText(host, 'ABORT JOB');
      expect(group).toBeInstanceOf(HTMLElement);
      expect(pauseButton?.style.minHeight).toBe('48px');
      expect(abortButton?.style.minWidth).toBe('144px');
      expect(abortButton?.title).toContain('not a safety-rated stop');
      await act(async () => pauseButton?.click());
      await act(async () => abortButton?.click());
      expect(pauseJob).toHaveBeenCalledOnce();
      expect(stopJob).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps Pause available after every line is acknowledged while the machine still runs', async () => {
    const pauseJob = vi.fn(async () => undefined);
    useLaserStore.setState({
      streamer: { ...streamingStreamer(), status: 'done', inFlight: [] },
      statusReport: {
        state: 'Run',
        subState: null,
        mPos: { x: 2, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 1_000,
        spindle: 100,
      },
      pauseJob,
    });
    const { host, root } = await render(<LiveMotionBar />);
    try {
      const pauseButton = buttonByText(host, 'Pause');
      expect(pauseButton).toBeDefined();
      await act(async () => pauseButton?.click());
      expect(pauseJob).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('shows a gated Resume and reachable Abort for a paused CNC job', async () => {
    useLaserStore.setState({
      streamer: pause(streamingStreamer()),
      activeJobMachineKind: 'cnc',
    });
    const { host, root } = await render(<LiveMotionBar />);
    try {
      expect(buttonByText(host, 'Resume')?.disabled).toBe(true);
      expect(buttonByText(host, 'ABORT JOB')?.disabled).toBe(false);
      expect(host.textContent).toContain('JOB PAUSED');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('uses an operation-specific Abort label outside a streaming job', async () => {
    useLaserStore.setState({
      controllerOperation: {
        kind: 'probe',
        phase: 'sequence',
        idleReports: 0,
        transactionId: 1,
        affectsXy: true,
      },
    });
    const { host, root } = await render(<LiveMotionBar />);
    try {
      expect(buttonByText(host, 'ABORT MOTION')).toBeDefined();
      expect(host.textContent).toContain('Probing');
      expect(buttonByText(host, 'Pause')).toBeUndefined();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('owns gated tool-change Continue beside the single Abort action', async () => {
    const continueToolChange = vi.fn(async () => undefined);
    useLaserStore.setState({
      streamer: readyToolChangeStreamer(),
      toolChangeIdleSeen: true,
      workZZeroEvidence: null,
      continueToolChange,
    });
    const { host, root } = await render(<LiveMotionBar />);
    try {
      expect(buttonByText(host, 'Continue')?.disabled).toBe(true);
      expect(buttonByText(host, 'ABORT JOB')).toBeDefined();
      await act(async () => {
        useLaserStore.setState({
          workZZeroEvidence: {
            source: 'manual-zero',
            referenceEpoch: useLaserStore.getState().workZReferenceEpoch,
          },
        });
      });
      const continueButton = buttonByText(host, 'Continue');
      expect(continueButton?.disabled).toBe(false);
      expect(continueButton?.title).toContain('safe Z with the spindle off');
      await act(async () => continueButton?.click());
      expect(continueToolChange).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it.each(['errored', 'done'] as const)(
    'keeps the single Abort escape available while a job is %s',
    async (status) => {
      useLaserStore.setState({ streamer: { ...streamingStreamer(), status, inFlight: [] } });
      const { host, root } = await render(<LiveMotionBar />);
      try {
        expect(buttonsByText(host, 'ABORT JOB')).toHaveLength(1);
        expect(buttonByText(host, 'Pause')).toBeUndefined();
        expect(buttonByText(host, 'Resume')).toBeUndefined();
      } finally {
        await act(async () => root.unmount());
      }
    },
  );

  it('renders nothing while the machine is idle', async () => {
    const { host, root } = await render(<LiveMotionBar />);
    try {
      expect(host.firstElementChild).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
});

function buttonsByText(host: HTMLElement, text: string): ReadonlyArray<HTMLButtonElement> {
  return [...host.querySelectorAll('button')].filter((button) => button.textContent === text);
}
