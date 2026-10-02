import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import {
  finishMark,
  prepareMarkRequest,
  readyMarkPort,
  waitForMark,
} from '../state/laser-job-start-mark.test-support';
import { MomentaryFireControl } from './MomentaryFireControl';
import { JobStartMarkControl } from './JobStartMarkControl';
import { JobActionControls } from './JobActionControls';
import { runJobStartMarkNow, useJobStartMarkPreparation } from './use-job-start-mark';
import * as startSource from './start-job-source';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useExperimentalLaserFeatures.getState().resetFeatures();
  useJobStartMarkPreparation.setState({ pending: false });
  vi.restoreAllMocks();
});

async function renderMark(): Promise<HTMLButtonElement> {
  await act(async () => root.render(<JobStartMarkControl disabled={false} />));
  const button = host.querySelector('button');
  if (button === null) throw new Error('The laser mark control is missing.');
  return button;
}

describe('mounted mark control and held Fire ownership', () => {
  it('shows the disabled mark and its Labs opt-in reason before Fire is enabled', async () => {
    await readyMarkPort();
    useExperimentalLaserFeatures.getState().resetFeatures();
    const button = await renderMark();
    expect(button.textContent).toBe('Mark job start · 1 s');
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('Tools > Labs');
  });

  it('explains the profile opt-in and becomes available only after explicit approval', async () => {
    await readyMarkPort();
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        device: { ...project.device, fireControl: { enabled: false, maxPowerPercent: 5 } },
      },
    });
    const button = await renderMark();
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('Machine Setup > Options');
    await act(async () => useStore.setState({ project }));
    expect(button.disabled).toBe(false);
  });

  it('ignores unrelated global Fire release events while the actual three-ACK mark pulse owns its M5', async () => {
    const port = await readyMarkPort();
    port.holdPulseAcks = true;
    const request = await prepareMarkRequest();
    await act(async () => root.render(<MomentaryFireControl />));
    let pending!: Promise<void>;
    await act(async () => {
      pending = useLaserStore.getState().markJobStart(request);
    });
    void pending.catch(() => undefined);
    await act(async () => waitForMark(port.pulsePending));
    const baseline = port.writes.length;
    await act(async () => {
      window.dispatchEvent(new Event('pointerup'));
      window.dispatchEvent(new Event('pointercancel'));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
      window.dispatchEvent(new Event('blur'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(port.writes.slice(baseline)).toEqual([]);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(2);
    expect(useLaserStore.getState().fireActive).toBe(true);
    await act(async () => {
      port.finishPulse();
      await finishMark(pending);
    });
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(port.writes.filter((line) => line === 'M5\n')).toHaveLength(1);
    expect(useLaserStore.getState().completedFrame).toBe(request.frame);
  });

  it('reserves actual-store Start and Frame plus their buttons during deferred mark compilation', async () => {
    const port = await readyMarkPort();
    const request = await prepareMarkRequest();
    const compile = startSource.prepareCurrentStartJob;
    let release!: () => void;
    let compiling = false;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    vi.spyOn(startSource, 'prepareCurrentStartJob').mockImplementationOnce(async (...args) => {
      compiling = true;
      await gate;
      return compile(...args);
    });
    await act(async () =>
      root.render(
        <>
          <JobStartMarkControl disabled={false} />
          <JobActionControls disabled={false} streaming={false} onStartJob={() => undefined} />
        </>,
      ),
    );
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = runJobStartMarkNow();
    });
    await act(async () => waitForMark(() => compiling));
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'interactive-command',
    });
    expect(useLaserStore.getState().completedFrame).toBe(request.frame);
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.find((button) => button.textContent?.includes('Start'))?.disabled).toBe(true);
    expect(buttons.find((button) => button.textContent?.includes('Frame again'))?.disabled).toBe(
      true,
    );
    const baseline = port.writes.length;
    await act(async () => {
      await expect(
        useLaserStore
          .getState()
          .startJob(
            request.prepared.gcode,
            request.frame === null ? {} : { framedRunPermit: request.frame },
          ),
      ).rejects.toThrow('controller operation');
      await expect(
        useLaserStore.getState().frame({ minX: 1, minY: 1, maxX: 9, maxY: 9 }, 1000),
      ).rejects.toThrow('controller operation');
    });
    expect(port.writes.length).toBe(baseline);
    release();
    await act(async () => finishMark(pending.then(() => undefined)));
    expect(await pending).toBe(true);
    expect(port.marks).toHaveLength(1);
  });

  it('does not hand off a prepared mark after its preparation owner is cancelled', async () => {
    const port = await readyMarkPort();
    await prepareMarkRequest();
    const compile = startSource.prepareCurrentStartJob;
    let release!: () => void;
    let compiling = false;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    vi.spyOn(startSource, 'prepareCurrentStartJob').mockImplementationOnce(async (...args) => {
      compiling = true;
      await gate;
      return compile(...args);
    });
    const pending = runJobStartMarkNow();
    await waitForMark(() => compiling);
    useLaserStore.setState({
      controllerOperation: null,
      manualMotionCancelEpoch: useLaserStore.getState().manualMotionCancelEpoch + 1,
    });
    release();
    await finishMark(pending.then(() => undefined));
    expect(await pending).toBe(false);
    expect(port.marks).toHaveLength(0);
    expect(port.writes.some((line) => line.includes(' G1 X'))).toBe(false);
  });
});
