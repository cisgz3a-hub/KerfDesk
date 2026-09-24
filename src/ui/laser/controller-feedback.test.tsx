// Controller controls must show what they will do and why they cannot
// (controller audit 2026-09-23): Manual Air is disabled with the store's own
// reason instead of swallowing the refusal (ui-panel-6), Zero Z reports both
// outcomes (ui-panel-5), and the Alarm banner names the commands the active
// driver really sends (ui-panel-8).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { AlarmRecoveryActions } from './AlarmRecoveryActions';
import { JogPadAirAssist } from './JogPadAirAssist';
import { useZeroZAction } from './use-zero-z-action';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const original = useLaserStore.getState();

async function render(node: JSX.Element): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(node);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

function idle() {
  return {
    state: 'Idle' as const,
    subState: null,
    mPos: { x: 0, y: 0, z: 0 },
    wPos: null,
    wco: null,
    feed: 0,
    spindle: 0,
  };
}

afterEach(() => {
  useLaserStore.setState(original, true);
  useStore.setState({ project: createProject() });
  useToastStore.setState({ toasts: [] });
});

describe('Manual Air', () => {
  it('is disabled with the reason while disconnected', async () => {
    useStore.getState().updateDeviceProfile({ airAssistCommand: 'M8' });
    const { host, unmount } = await render(<JogPadAirAssist />);
    try {
      const button = host.querySelector('button');
      expect(button?.disabled).toBe(true);
      expect(button?.title).toBe('Connect to the laser first.');
    } finally {
      await unmount();
    }
  });

  it('is enabled on a connected, Idle controller', async () => {
    useStore.getState().updateDeviceProfile({ airAssistCommand: 'M8' });
    useLaserStore.setState({ connection: { kind: 'connected' }, statusReport: idle() } as Partial<
      ReturnType<typeof useLaserStore.getState>
    >);
    const { host, unmount } = await render(<JogPadAirAssist />);
    try {
      expect(host.querySelector('button')?.disabled).toBe(false);
    } finally {
      await unmount();
    }
  });
});

describe('Zero Z feedback', () => {
  function ZeroZButton(): JSX.Element {
    const zeroZ = useZeroZAction();
    return (
      <button type="button" onClick={zeroZ}>
        Zero Z
      </button>
    );
  }

  it('confirms success and explains a refusal', async () => {
    const zeroZHere = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Wait for the previous controller command.'));
    useLaserStore.setState({ zeroZHere });
    const { host, unmount } = await render(<ZeroZButton />);
    try {
      const button = host.querySelector('button') as HTMLButtonElement;
      await act(async () => button.click());
      await act(async () => button.click());
      const messages = useToastStore.getState().toasts.map((toast) => toast.message);
      expect(messages).toEqual([
        'Work Z0 set at the current bit height (G92 Z0).',
        'Zero Z: Wait for the previous controller command.',
      ]);
    } finally {
      await unmount();
    }
  });
});

describe('Alarm banner commands', () => {
  async function labels(
    kind: 'grbl-v1.1' | 'smoothieware' | 'grblhal',
    commandSet?: 'creality-falcon-a1-pro',
  ): Promise<{ readonly texts: string[]; readonly titles: string[] }> {
    useLaserStore.setState({
      activeControllerKind: kind,
      activeControllerCommandSet: commandSet ?? null,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await render(
      <AlarmRecoveryActions
        homingEnabled
        canUnlock
        onHome={() => undefined}
        onConfigureHoming={() => undefined}
        onUnlock={() => undefined}
      />,
    );
    const buttons = [...host.querySelectorAll('button')];
    const result = {
      texts: buttons.map((button) => button.textContent ?? ''),
      titles: buttons.map((button) => button.title),
    };
    await unmount();
    return result;
  }

  it('keeps the GRBL labels', async () => {
    expect((await labels('grbl-v1.1')).texts).toEqual(['Home ($H)', '$X — Unlock']);
  });

  it('names Smoothieware unlock as M999', async () => {
    expect((await labels('smoothieware')).texts).toContain('M999 — Unlock');
  });

  it('spells out the Falcon two-axis Home sequence', async () => {
    const falcon = await labels('grblhal', 'creality-falcon-a1-pro');
    expect(falcon.texts[0]).toBe('Home');
    expect(falcon.titles[0]).toContain('$HX then $HY');
  });
});
