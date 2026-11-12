// The guided first job on a K40, Moshiboard or Ruida link (ADR-703 Amendment
// 1, code quality audit C2 D6-P2-3): the link's connection, its completed
// Frame and its running job move the guide on, as the serial laser's do.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  reportLinkMachineStatus,
  reportLinkMachineWork,
  resetLinkMachineWorkForTests,
} from '../state/link-machine-work';
import { resetStore } from '../state/test-helpers';
import { useFirstJobGuideStore } from './first-job-guide-store';
import type { FirstJobSignals } from './first-job-steps';
import { useFirstJobSignals } from './use-first-job-signals';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let seen: FirstJobSignals | null = null;
let root: Root | null = null;

function Probe(): null {
  seen = useFirstJobSignals();
  return null;
}

beforeEach(async () => {
  resetStore();
  resetLinkMachineWorkForTests();
  useFirstJobGuideStore.setState({ open: false, skipped: new Set(), jobStarted: false });
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<Probe />));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  seen = null;
  document.body.replaceChildren();
  resetLinkMachineWorkForTests();
  useFirstJobGuideStore.setState({ open: false, skipped: new Set(), jobStarted: false });
});

describe('first job signals over a controller link', () => {
  it('counts a connected link and its completed Frame', async () => {
    expect(seen?.connected).toBe(false);
    expect(seen?.framedReady).toBe(false);
    await act(async () =>
      reportLinkMachineStatus('lihuiyu-usb', { connected: true, framed: false }),
    );
    expect(seen?.connected).toBe(true);
    expect(seen?.framedReady).toBe(false);
    await act(async () =>
      reportLinkMachineStatus('lihuiyu-usb', { connected: true, framed: true }),
    );
    expect(seen?.framedReady).toBe(true);
  });

  it('latches the job step when a link job runs, even after it ends', async () => {
    await act(async () =>
      reportLinkMachineWork('ruida-network', {
        controller: 'Ruida',
        activity: 'running',
        advisories: [],
        abort: () => Promise.resolve(),
      }),
    );
    await act(async () => reportLinkMachineWork('ruida-network', null));
    expect(seen?.jobStarted).toBe(true);
  });

  it('does not count a link Frame as a started job', async () => {
    await act(async () =>
      reportLinkMachineWork('moshi-usb', {
        controller: 'Moshiboard',
        activity: 'framing',
        advisories: [],
        abort: () => Promise.resolve(),
      }),
    );
    expect(seen?.jobStarted).toBe(false);
  });
});
