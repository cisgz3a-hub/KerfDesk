// CNC-04 — RunningControls shows a Continue button and the re-zero instruction
// while a job is held at an M0 tool change, and mounts Stop throughout.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createStreamer, onAck, step } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { RunningControls } from './JobRunControls';

function currentWorkZEvidence() {
  return {
    source: 'manual-zero' as const,
    referenceEpoch: useLaserStore.getState().workZReferenceEpoch,
  };
}

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderRunningControls(props: {
  isStreaming: boolean;
  isPaused: boolean;
  isToolChange: boolean;
}): Promise<{ host: HTMLElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<RunningControls {...props} />);
  });
  return { host, root };
}

let cleanup: (() => Promise<void>) | null = null;

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

afterEach(async () => {
  if (cleanup !== null) await cleanup();
  cleanup = null;
  useLaserStore.setState({
    pendingToolLabel: null,
    streamer: null,
    toolChangeIdleSeen: false,
    workZZeroEvidence: null,
  });
});

describe('RunningControls tool-change (CNC-04)', () => {
  it('shows Continue + the re-zero instruction and keeps Stop while held at a tool change', async () => {
    useLaserStore.setState({
      streamer: readyToolChangeStreamer(),
      toolChangeIdleSeen: true,
      workZZeroEvidence: null,
    });
    const { host, root } = await renderRunningControls({
      isStreaming: false,
      isPaused: false,
      isToolChange: true,
    });
    cleanup = async () => {
      await act(async () => root.unmount());
      host.remove();
    };

    expect(host.textContent).toContain('Continue');
    expect(host.textContent).toContain('Stop');
    expect(host.textContent).toContain('re-zero Z on the stock top');
    expect(host.textContent).toContain('Continue unlocks only after fresh Idle and Z zero');
    const continueButton = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Continue',
    );
    expect(continueButton?.disabled).toBe(true);
    // Pause/Resume belong to streaming/paused, not a tool-change hold.
    expect(host.textContent).not.toContain('Pause');
    expect(host.textContent).not.toContain('Resume');
  });

  it('enables Continue only after Z zero and explains the spindle-off lift', async () => {
    useLaserStore.setState({
      streamer: readyToolChangeStreamer(),
      toolChangeIdleSeen: true,
      workZZeroEvidence: currentWorkZEvidence(),
    });
    const { host, root } = await renderRunningControls({
      isStreaming: false,
      isPaused: false,
      isToolChange: true,
    });
    cleanup = async () => {
      await act(async () => root.unmount());
      host.remove();
    };

    const continueButton = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Continue',
    );
    expect(continueButton?.disabled).toBe(false);
    expect(continueButton?.title).toContain('safe Z with the spindle off');
  });

  it('names the bit in the prompt when the compiled label is known (R5)', async () => {
    useLaserStore.setState({ pendingToolLabel: '6.35 mm end mill' });
    const { host, root } = await renderRunningControls({
      isStreaming: false,
      isPaused: false,
      isToolChange: true,
    });
    cleanup = async () => {
      await act(async () => root.unmount());
      host.remove();
    };

    expect(host.textContent).toContain('Load 6.35 mm end mill');
    expect(host.textContent).not.toContain('Load the next bit');
  });

  it('does not show Continue for an ordinary streaming job', async () => {
    const { host, root } = await renderRunningControls({
      isStreaming: true,
      isPaused: false,
      isToolChange: false,
    });
    cleanup = async () => {
      await act(async () => root.unmount());
      host.remove();
    };

    expect(host.textContent).not.toContain('Continue');
    expect(host.textContent).toContain('Pause');
  });
});
