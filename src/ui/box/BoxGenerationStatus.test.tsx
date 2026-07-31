import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoxSpec } from '../../core/box';
import { estimateBoxWork } from '../../core/box/box-work-estimate';
import { BoxGenerationStatus } from './BoxGenerationStatus';
import type { BoxGenerationState } from './use-box-generation';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SPEC: BoxSpec = {
  widthMm: 60,
  depthMm: 40,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'closed',
  clearanceMm: 0,
  relief: { kind: 'none' },
  partSpacingMm: 8,
};

const PENDING: BoxGenerationState = {
  kind: 'pending',
  requestId: 1,
  specKey: JSON.stringify(SPEC),
  estimate: estimateBoxWork(SPEC),
};

const LARGE_SPEC: BoxSpec = {
  ...SPEC,
  widthMm: 5000,
  targetFingerWidthMm: 3,
};

const LARGE_SYNCHRONOUS_READY: BoxGenerationState = {
  kind: 'ready',
  snapshot: {
    requestId: 2,
    specKey: JSON.stringify(LARGE_SPEC),
    spec: LARGE_SPEC,
    panels: [],
    estimate: estimateBoxWork(LARGE_SPEC),
    metrics: { panelCount: 6, ringCount: 6, pointCount: 20_001 },
    generationMode: 'synchronous-fallback',
  },
};

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('BoxGenerationStatus', () => {
  it('announces pending work at 50 ms without hiding its cancel action', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <BoxGenerationStatus
          state={PENDING}
          staleMessage={null}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
        />,
      );
    });

    expect(host.textContent).toContain('Cancel preview generation');
    expect(host.textContent).not.toContain('Generating preview for current values');
    await act(async () => vi.advanceTimersByTime(49));
    expect(host.textContent).not.toContain('Generating preview for current values');
    await act(async () => vi.advanceTimersByTime(1));
    expect(host.textContent).toContain('Generating preview for current values');

    await act(async () => root.unmount());
  });

  it('does not claim a large synchronous fallback remains background-cancellable', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <BoxGenerationStatus
          state={LARGE_SYNCHRONOUS_READY}
          staleMessage={null}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
        />,
      );
    });

    expect(host.textContent).toContain('generated synchronously');
    expect(host.textContent).toContain('temporarily make the app unresponsive');
    expect(host.textContent).not.toContain('remains cancellable');

    await act(async () => root.unmount());
  });
});
