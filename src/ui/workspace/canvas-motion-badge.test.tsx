import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import { startLiveCanvasRun, type CanvasMotionPlan } from '../state/canvas-motion-plan';
import type { CanvasMotionOverlay } from './draw-canvas-motion';
import { CanvasMotionBadge } from './canvas-motion-badge';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const GCODE = 'G21\nG90\nM3 S12000\nG1 Z-1 F300\nG1 X10 F1000\nG1 Z-2 F300\nG1 X0 F1000';

function cncPlan(): CanvasMotionPlan {
  return {
    manifest: buildMotionManifest(GCODE, { machineKind: 'cnc' }),
    fingerprint: fingerprintGcode(GCODE),
    retentionKey: 'badge-cnc',
    machineKind: 'cnc',
    device: DEFAULT_DEVICE_PROFILE,
    coordinateFrame: { kind: 'machine', workOffsetMm: { x: 0, y: 0, z: 0 } },
    framePerimeter: [],
    jobStart: { x: 0, y: 0 },
    approachFrom: null,
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: 0,
    cncPassSpans: [
      { groupIndex: 0, passIndex: 0, routeStartMm: 0, routeEndMm: 11 },
      { groupIndex: 0, passIndex: 1, routeStartMm: 11, routeEndMm: 22 },
      { groupIndex: 0, passIndex: 2, routeStartMm: 22, routeEndMm: 33 },
    ],
  };
}

function runningOverlay(confirmedRouteMm: number): CanvasMotionOverlay {
  const plan = cncPlan();
  return {
    plan,
    run: {
      ...startLiveCanvasRun(plan),
      reportedHead: { x: 5, y: 0, z: -1 },
      route: { confirmedRouteMm, candidates: [], uncertain: false },
      controllerState: 'Run',
    },
  };
}

async function renderBadge(overlay: CanvasMotionOverlay): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<CanvasMotionBadge overlay={overlay} />);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

describe('CanvasMotionBadge pass progress (ADR-216)', () => {
  it('shows the running pass and how many passes remain', async () => {
    const { host, unmount } = await renderBadge(runningOverlay(15));
    try {
      const status = host.querySelector('[data-testid="canvas-motion-status"]');
      expect(status?.textContent).toContain('Pass 2 of 3');
      expect(status?.textContent).toContain('1 remaining');
      const probe = host.querySelector('[data-testid="canvas-motion-probe"]');
      expect(probe?.getAttribute('data-pass-current')).toBe('2');
      expect(probe?.getAttribute('data-pass-total')).toBe('3');
    } finally {
      await unmount();
    }
  });

  it('drops the remaining count on the final pass', async () => {
    const { host, unmount } = await renderBadge(runningOverlay(30));
    try {
      const status = host.querySelector('[data-testid="canvas-motion-status"]');
      expect(status?.textContent).toContain('Pass 3 of 3');
      expect(status?.textContent).not.toContain('remaining');
    } finally {
      await unmount();
    }
  });

  it('shows no pass text for a plan without pass spans', async () => {
    const plan = cncPlan();
    const { cncPassSpans: _omitted, ...withoutSpans } = plan;
    const overlay: CanvasMotionOverlay = {
      plan: withoutSpans,
      run: {
        ...startLiveCanvasRun(withoutSpans),
        reportedHead: { x: 5, y: 0, z: -1 },
        controllerState: 'Run',
      },
    };
    const { host, unmount } = await renderBadge(overlay);
    try {
      const status = host.querySelector('[data-testid="canvas-motion-status"]');
      expect(status?.textContent).not.toContain('Pass');
      const probe = host.querySelector('[data-testid="canvas-motion-probe"]');
      expect(probe?.getAttribute('data-pass-current')).toBeNull();
    } finally {
      await unmount();
    }
  });
});

function feedOverlay(
  feedMmPerMin: number | null,
  lifecycle: 'running' | 'paused' = 'running',
): CanvasMotionOverlay {
  const plan = cncPlan();
  return {
    plan,
    run: {
      ...startLiveCanvasRun(plan),
      reportedHead: { x: 5, y: 0, z: -1 },
      route: { confirmedRouteMm: 5, candidates: [], uncertain: false },
      controllerState: lifecycle === 'running' ? 'Run' : 'Hold',
      lifecycle,
      reportedFeedMmPerMin: feedMmPerMin,
    },
  };
}

describe('CanvasMotionBadge feed rate (ADR-217)', () => {
  it('shows the rounded live feed rate in mm/min while running', async () => {
    const { host, unmount } = await renderBadge(feedOverlay(1499.6));
    try {
      const status = host.querySelector('[data-testid="canvas-motion-status"]');
      expect(status?.textContent).toContain('1500 mm/min');
      const probe = host.querySelector('[data-testid="canvas-motion-probe"]');
      expect(probe?.getAttribute('data-reported-feed')).toBe('1499.6');
    } finally {
      await unmount();
    }
  });

  it('omits the feed rate when the controller reports no FS sample', async () => {
    const { host, unmount } = await renderBadge(feedOverlay(null));
    try {
      const status = host.querySelector('[data-testid="canvas-motion-status"]');
      expect(status?.textContent).not.toContain('mm/min');
      const probe = host.querySelector('[data-testid="canvas-motion-probe"]');
      expect(probe?.getAttribute('data-reported-feed')).toBeNull();
    } finally {
      await unmount();
    }
  });

  it('hides the feed rate while paused (a held machine reports zero)', async () => {
    const { host, unmount } = await renderBadge(feedOverlay(0, 'paused'));
    try {
      const status = host.querySelector('[data-testid="canvas-motion-status"]');
      expect(status?.textContent).not.toContain('mm/min');
    } finally {
      await unmount();
    }
  });
});

function laserPlan(): CanvasMotionPlan {
  const { cncPassSpans: _drop, ...rest } = cncPlan();
  return { ...rest, machineKind: 'laser', retentionKey: 'badge-laser' };
}

function spindleOverlay(opts: {
  readonly spindle: number | null;
  readonly plan?: CanvasMotionPlan;
  readonly lifecycle?: 'running' | 'paused';
}): CanvasMotionOverlay {
  const plan = opts.plan ?? cncPlan();
  const lifecycle = opts.lifecycle ?? 'running';
  return {
    plan,
    run: {
      ...startLiveCanvasRun(plan),
      reportedHead: { x: 5, y: 0, z: -1 },
      route: { confirmedRouteMm: 5, candidates: [], uncertain: false },
      controllerState: lifecycle === 'running' ? 'Run' : 'Hold',
      lifecycle,
      reportedSpindleRpm: opts.spindle,
    },
  };
}

describe('CanvasMotionBadge spindle RPM (ADR-220)', () => {
  it('shows the rounded spindle speed in rpm while a CNC job runs', async () => {
    const { host, unmount } = await renderBadge(spindleOverlay({ spindle: 12000 }));
    try {
      const status = host.querySelector('[data-testid="canvas-motion-status"]');
      expect(status?.textContent).toContain('12000 rpm');
      const probe = host.querySelector('[data-testid="canvas-motion-probe"]');
      expect(probe?.getAttribute('data-reported-spindle')).toBe('12000');
    } finally {
      await unmount();
    }
  });

  it('never labels a laser power value as rpm (spindle is CNC-only)', async () => {
    const { host, unmount } = await renderBadge(
      spindleOverlay({ spindle: 500, plan: laserPlan() }),
    );
    try {
      const status = host.querySelector('[data-testid="canvas-motion-status"]');
      expect(status?.textContent).not.toContain('rpm');
    } finally {
      await unmount();
    }
  });

  it('omits the spindle speed when the controller reports none', async () => {
    const { host, unmount } = await renderBadge(spindleOverlay({ spindle: null }));
    try {
      const status = host.querySelector('[data-testid="canvas-motion-status"]');
      expect(status?.textContent).not.toContain('rpm');
      const probe = host.querySelector('[data-testid="canvas-motion-probe"]');
      expect(probe?.getAttribute('data-reported-spindle')).toBeNull();
    } finally {
      await unmount();
    }
  });

  it('hides the spindle speed while paused', async () => {
    const { host, unmount } = await renderBadge(
      spindleOverlay({ spindle: 12000, lifecycle: 'paused' }),
    );
    try {
      const status = host.querySelector('[data-testid="canvas-motion-status"]');
      expect(status?.textContent).not.toContain('rpm');
    } finally {
      await unmount();
    }
  });
});
