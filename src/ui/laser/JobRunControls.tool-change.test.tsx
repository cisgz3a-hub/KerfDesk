// CNC-04 — RunningControls keeps the detailed tool-change instruction while the
// canonical Continue and Abort actions remain in LiveMotionBar (ADR-207).
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
    pendingToolId: null,
    streamer: null,
    toolChangeIdleSeen: false,
    workZZeroEvidence: null,
  });
});

describe('RunningControls tool-change (CNC-04)', () => {
  it('shows the re-zero instruction without duplicating the top-bar actions', async () => {
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
    expect(host.textContent).toContain('re-zero Z on the stock top');
    expect(host.textContent).toContain(
      'Continue unlocks only after fresh Idle and tool-matched Z zero',
    );
    expect(host.querySelectorAll('button')).toHaveLength(0);
  });

  it('explains the spindle-off lift after Z zero without owning Continue', async () => {
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

    expect(host.querySelectorAll('button')).toHaveLength(0);
    expect(host.textContent).toContain('lifts to safe Z before spindle start');
  });

  it('names the bit in the prompt when the compiled label is known (R5)', async () => {
    useLaserStore.setState({ pendingToolLabel: '6.35 mm end mill', pendingToolId: 'em-6350' });
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
    expect(host.textContent).toContain('select it as the Active bit');
    expect(host.textContent).not.toContain('Load the next bit');
  });

  it('shows ordinary streaming safety copy without a duplicate Pause button', async () => {
    const { host, root } = await renderRunningControls({
      isStreaming: true,
      isPaused: false,
      isToolChange: false,
    });
    cleanup = async () => {
      await act(async () => root.unmount());
      host.remove();
    };

    expect(host.textContent).toContain('Pause');
    expect([...host.querySelectorAll('button')].map((button) => button.textContent)).not.toContain(
      'Pause',
    );
  });
});
