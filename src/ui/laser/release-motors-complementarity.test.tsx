import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { NoHomingPositionGuide } from './NoHomingPositionGuide';
import { OriginRow } from './OriginRow';

// Release motors ($SLP) has exactly two surfaces, and they must be exactly
// complementary: the Origin row carries it precisely when the Position job
// card does not. That invariant lives in two files and holds only while both
// key on the SAME origin predicate — OriginRow's release gate and the guide's
// `originSettled`. Neither file's own tests can see the invariant, so a change
// to one predicate alone merges clean and silently doubles the control.
//
// The Z-only touch-off is the state that separates the two predicates:
// hasCustomOrigin counts |z|, hasCustomXyOrigin does not.

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalLaser = {
  releaseMotors: useLaserStore.getState().releaseMotors,
  wakeController: useLaserStore.getState().wakeController,
  unlockAlarm: useLaserStore.getState().unlockAlarm,
  setOriginHere: useLaserStore.getState().setOriginHere,
  capabilities: useLaserStore.getState().capabilities,
};

type LaserStatus = NonNullable<ReturnType<typeof useLaserStore.getState>['statusReport']>;

function status(state: LaserStatus['state']): LaserStatus {
  return { state } as LaserStatus;
}

/** Every control that releases the motors, across both surfaces. */
function releaseControls(host: HTMLElement): ReadonlyArray<HTMLButtonElement> {
  return [...host.querySelectorAll('button')].filter((candidate) =>
    /release (the )?motors/i.test(candidate.textContent ?? ''),
  );
}

async function renderRail(host: HTMLElement): Promise<Root> {
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <>
        <OriginRow disabled={false} streaming={false} />
        <NoHomingPositionGuide disabled={false} streaming={false} />
      </>,
    );
  });
  if (root === null) throw new Error('rail did not mount');
  return root;
}

afterEach(() => {
  useStore.setState({ project: createProject() });
  useLaserStore.setState({
    ...originalLaser,
    connection: { kind: 'disconnected' },
    statusReport: null,
    workOriginActive: false,
    workOriginSource: 'none',
    wcoCache: null,
  });
  vi.restoreAllMocks();
});

describe('Release motors is offered by exactly one surface', () => {
  async function expectExactlyOneRelease(
    wcoCache: { x: number; y: number; z: number } | null,
  ): Promise<void> {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: status('Idle'),
      capabilities: { ...originalLaser.capabilities, sleep: true },
      workOriginActive: false,
      workOriginSource: 'none',
      wcoCache,
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      root = await renderRail(host);
      expect(releaseControls(host).map((b) => b.textContent)).toHaveLength(1);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  }

  // The divergence case: Zero Z touched off against stock, no XY origin ever
  // set. hasCustomOrigin sees the Z offset, hasCustomXyOrigin does not — so a
  // row gated on the Z-inclusive predicate renders Release while the card,
  // keyed on the XY-only one, has not yet left the rail.
  it('offers one control after a Z-only touch-off with no XY origin', async () => {
    await expectExactlyOneRelease({ x: 0, y: 0, z: -12.5 });
  });

  it('offers one control with no origin at all', async () => {
    await expectExactlyOneRelease(null);
  });

  it('offers one control once an XY origin is settled', async () => {
    await expectExactlyOneRelease({ x: 40, y: 25, z: 0 });
  });
});
