import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RgbaImage } from '../../../core/camera';
import type * as CameraModule from '../../../core/camera';
import type * as FrameSourceModule from '../frame-source';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { resetStore } from '../../state/test-helpers';
import { CameraAlignWizard } from './CameraAlignWizard';
import { useCameraAlignWizardStore } from './camera-align-wizard-store';

const capture = vi.hoisted(() => vi.fn());
vi.mock('../frame-source', async (original) => ({
  ...(await original<typeof FrameSourceModule>()),
  captureSourceFrame: capture,
}));
vi.mock('../CameraSourceView', () => ({ CameraSourceView: () => null }));
vi.mock('../../../core/camera', async (original) => ({
  ...(await original<typeof CameraModule>()),
  detectAlignMarkers: () => ({ kind: 'ok' }),
  solveMarkerAlignment: () => ({
    kind: 'ok',
    homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    verificationErrorMm: 0,
  }),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const initialCamera = useCameraStore.getState();
let root: Root | null = null;
let host: HTMLElement;

function deferred() {
  let resolve!: (frame: RgbaImage | null) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<RgbaImage | null>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function frame(width = 8): RgbaImage {
  return { width, height: 8, data: new Uint8ClampedArray(width * 8 * 4) };
}
function Host(): JSX.Element | null {
  return useCameraAlignWizardStore((state) => state.open) ? <CameraAlignWizard /> : null;
}
function openDetect(): void {
  const wizard = useCameraAlignWizardStore.getState();
  wizard.openWizard();
  wizard.setPlaneHeightMm(3);
  wizard.setStep({ kind: 'detect', status: { kind: 'idle' } });
}
async function click(label: string): Promise<void> {
  const button = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
  );
  if (!button) throw new Error(`missing ${label}`);
  await act(async () => button.click());
}
beforeEach(async () => {
  resetStore();
  capture.mockReset();
  useCameraStore.setState({
    ...initialCamera,
    sourceState: {
      kind: 'live',
      source: {
        kind: 'machine-jpeg',
        frameUrl: 'http://example.invalid/frame',
        cameraUrl: 'http://example.invalid/camera',
      },
    },
  });
  openDetect();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<Host />));
});
afterEach(async () => {
  await act(async () => {
    useCameraAlignWizardStore.getState().closeWizard();
    root?.unmount();
  });
  root = null;
  host.remove();
  useCameraStore.setState(initialCamera, true);
  resetStore();
});

describe('alignment request ownership', () => {
  it('ignores a delayed successful capture after Exit and project replacement', async () => {
    const pending = deferred();
    capture.mockReturnValueOnce(pending.promise);
    await click('Detect markers');
    await click('Close Align camera to bed');
    useStore.getState().newProject();
    const device = useStore.getState().project.device;
    const step = useCameraAlignWizardStore.getState().step;
    await act(async () => pending.resolve(frame()));
    expect(useStore.getState().project.device).toBe(device);
    expect(useCameraAlignWizardStore.getState().step).toBe(step);
    expect(useCameraStore.getState().surfaceHeightMm).toBe(0);
  });

  it.each(['document', 'device', 'source', 'height'] as const)(
    'retires the pending result immediately when %s ownership changes',
    async (change) => {
      const pending = deferred();
      capture.mockReturnValueOnce(pending.promise);
      await click('Detect markers');
      await act(async () => {
        if (change === 'document')
          useStore.setState((state) => ({ projectDocumentEpoch: state.projectDocumentEpoch + 1 }));
        if (change === 'device') useStore.getState().updateDeviceProfile({ bedWidth: 350 });
        if (change === 'source') {
          const before = useCameraStore.getState();
          useCameraStore.setState({ sourceState: { kind: 'idle' } });
          useCameraStore.setState({ sourceState: before.sourceState });
        }
        if (change === 'height') useCameraAlignWizardStore.getState().setPlaneHeightMm(5);
      });
      const device = useStore.getState().project.device;
      const step = useCameraAlignWizardStore.getState().step;
      expect(step).toEqual({ kind: 'detect', status: { kind: 'idle' } });
      await act(async () => pending.resolve(frame()));
      expect(useStore.getState().project.device).toBe(device);
      expect(useCameraAlignWizardStore.getState().step).toBe(step);
      expect(useCameraStore.getState().surfaceHeightMm).toBe(0);
    },
  );

  it('cannot overwrite a newer solve after Exit/reopen', async () => {
    const old = deferred();
    const newer = deferred();
    capture.mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);
    await click('Detect markers');
    await click('Close Align camera to bed');
    await act(async () => openDetect());
    await click('Detect markers');
    await act(async () => newer.resolve(frame(16)));
    const alignment = useStore.getState().project.device.cameraAlignment;
    expect(alignment?.frameWidth).toBe(16);
    await act(async () => old.resolve(frame(8)));
    expect(useStore.getState().project.device.cameraAlignment).toBe(alignment);
    expect(useCameraAlignWizardStore.getState().step.kind).toBe('done');
  });

  it('keeps the initiating request through minimize/expand and commits it once', async () => {
    const pending = deferred();
    capture.mockReturnValueOnce(pending.promise);
    await click('Detect markers');
    await click('Minimize');
    await click('Expand');
    await act(async () => pending.resolve(frame()));
    expect(useStore.getState().project.device.cameraAlignment).toMatchObject({
      frameWidth: 8,
      basis: 'raw',
      planeHeightMm: 3,
    });
    expect(useCameraStore.getState().surfaceHeightMm).toBe(3);
    expect(useCameraAlignWizardStore.getState().step).toEqual({ kind: 'done', basis: 'raw' });
    expect(capture).toHaveBeenCalledOnce();
  });

  it('does not publish a rejected old capture into a reopened wizard', async () => {
    const pending = deferred();
    capture.mockReturnValueOnce(pending.promise);
    await click('Detect markers');
    await click('Close Align camera to bed');
    await act(async () => openDetect());
    const step = useCameraAlignWizardStore.getState().step;
    await act(async () => pending.reject(new Error('late capture failure')));
    expect(useCameraAlignWizardStore.getState().step).toBe(step);
    expect(useStore.getState().project.device.cameraAlignment).toBeUndefined();
  });
});
