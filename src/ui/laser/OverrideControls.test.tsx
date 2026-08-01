// OverrideControls (ADR-103 G3): live percentages from ovCache and the
// exact GRBL realtime bytes fired per button.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RT_FEED_OV_MINUS_1,
  RT_FEED_OV_MINUS_10,
  RT_SPINDLE_OV_PLUS_1,
  RT_SPINDLE_OV_RESET,
  type RealtimeOverrideByte,
} from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { OverrideControls } from './OverrideControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  useLaserStore.setState({ ovCache: null, activeJobMachineKind: null } as Partial<
    ReturnType<typeof useLaserStore.getState>
  >);
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

  it('notes Feed also scales plunge on a CNC job, but never on a laser job', async () => {
    useLaserStore.setState({ activeJobMachineKind: 'cnc' } as Partial<
      ReturnType<typeof useLaserStore.getState>
    >);
    const cnc = await renderControls();
    try {
      expect(cnc.host.textContent).toContain('Feed also scales plunge');
    } finally {
      await act(async () => cnc.root.unmount());
      cnc.host.remove();
    }
    // A laser has no plunge — the Feed override there scales engrave speed and
    // the Spindle row is laser power, so the plunge note must not appear.
    useLaserStore.setState({ activeJobMachineKind: 'laser' } as Partial<
      ReturnType<typeof useLaserStore.getState>
    >);
    const laser = await renderControls();
    try {
      expect(laser.host.textContent).not.toContain('plunge');
    } finally {
      await act(async () => laser.root.unmount());
      laser.host.remove();
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
      // Fine steps: the '1%' substring separates them from the '10%' coarse
      // buttons that share the same "Slow/Raise the … override" prefix.
      const feedMinusFine = buttons.find(
        (b) => b.title.startsWith('Slow the feed') && b.title.includes('by 1%'),
      );
      const spindlePlusFine = buttons.find(
        (b) => b.title.startsWith('Raise the spindle') && b.title.includes('by 1%'),
      );
      if (
        feedMinus === undefined ||
        spindleReset === undefined ||
        feedMinusFine === undefined ||
        spindlePlusFine === undefined
      ) {
        throw new Error('override buttons missing');
      }
      await act(async () => {
        feedMinus.click();
        spindleReset.click();
        feedMinusFine.click();
        spindlePlusFine.click();
      });
      expect(send).toHaveBeenCalledWith(RT_FEED_OV_MINUS_10);
      expect(send).toHaveBeenCalledWith(RT_SPINDLE_OV_RESET);
      expect(send).toHaveBeenCalledWith(RT_FEED_OV_MINUS_1);
      expect(send).toHaveBeenCalledWith(RT_SPINDLE_OV_PLUS_1);
    } finally {
      useLaserStore.setState({ sendRealtimeOverride: original } as Partial<
        ReturnType<typeof useLaserStore.getState>
      >);
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
