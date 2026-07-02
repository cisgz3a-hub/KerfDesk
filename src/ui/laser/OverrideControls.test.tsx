// OverrideControls (ADR-102 G3): live percentages from ovCache and the
// exact GRBL realtime bytes fired per button.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RT_FEED_OV_MINUS_10,
  RT_SPINDLE_OV_RESET,
  type RealtimeOverrideByte,
} from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { OverrideControls } from './OverrideControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  useLaserStore.setState({ ovCache: null } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

async function renderControls(): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<OverrideControls />);
  });
  // Narrowing: assigned inside act.
  return { host, root: root as unknown as Root };
}

describe('OverrideControls', () => {
  it('shows cached Ov percentages, or dashes before the first Ov frame', async () => {
    const { host, root } = await renderControls();
    try {
      expect(host.textContent).toContain('—');
      await act(async () => {
        useLaserStore.setState({ ovCache: { feed: 120, rapid: 50, spindle: 90 } } as Partial<
          ReturnType<typeof useLaserStore.getState>
        >);
      });
      expect(host.textContent).toContain('120%');
      expect(host.textContent).toContain('90%');
      expect(host.textContent).toContain('50%');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('fires the exact realtime byte per button', async () => {
    const original = useLaserStore.getState().sendRealtimeOverride;
    const send = vi.fn(async (_byte: RealtimeOverrideByte) => undefined);
    useLaserStore.setState({ sendRealtimeOverride: send } as Partial<
      ReturnType<typeof useLaserStore.getState>
    >);
    const { host, root } = await renderControls();
    try {
      const buttons = [...host.querySelectorAll('button')];
      const feedMinus = buttons.find((b) => b.title.startsWith('Slow the feed'));
      const spindleReset = buttons.find((b) => b.title.startsWith('Reset the spindle'));
      if (feedMinus === undefined || spindleReset === undefined) {
        throw new Error('override buttons missing');
      }
      await act(async () => {
        feedMinus.click();
        spindleReset.click();
      });
      expect(send).toHaveBeenCalledWith(RT_FEED_OV_MINUS_10);
      expect(send).toHaveBeenCalledWith(RT_SPINDLE_OV_RESET);
    } finally {
      useLaserStore.setState({ sendRealtimeOverride: original } as Partial<
        ReturnType<typeof useLaserStore.getState>
      >);
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
