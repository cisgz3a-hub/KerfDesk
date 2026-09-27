import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { clickElement, mountControl } from '../../image-editor/control-audit-test-support';
import { loadPhoneCamera, savePhoneCamera } from '../../state/camera-preference-storage';
import { useCameraStore, type CameraSourceState } from '../../state/camera-store';
import { MachineCameraSection } from './MachineCameraSection';
import { PhoneCameraSection } from './PhoneCameraSection';

const PHONE_URL = 'http://192.168.1.50:8080/shot.jpg';
const FALCON_URL = 'http://192.168.10.1:8080/media/getCapturePhoto';

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};

function liveStill(cameraUrl: string): CameraSourceState {
  return {
    kind: 'live',
    source: {
      kind: 'machine-jpeg',
      cameraUrl,
      frameUrl: `http://127.0.0.1:51731/frame.jpg?url=${encodeURIComponent(cameraUrl)}`,
    },
  };
}

async function mountSection(): Promise<HTMLElement> {
  return mountControl(
    <PlatformProvider adapter={platform}>
      <PhoneCameraSection />
    </PlatformProvider>,
  );
}

function button(host: HTMLElement, label: string): HTMLButtonElement | null {
  return [...host.querySelectorAll('button')].find((b) => b.textContent === label) ?? null;
}

async function typeAddress(host: HTMLElement, text: string): Promise<void> {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Phone camera address"]');
  if (input === null) throw new Error('address field missing');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function chooseApp(host: HTMLElement, app: string): Promise<void> {
  const select = host.querySelector('select');
  if (select === null) throw new Error('app select missing');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, app);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const startSnapshotSource = vi.fn(async () => undefined);
const stopSource = vi.fn();
const original = useCameraStore.getState();

beforeEach(() => {
  localStorage.clear();
  startSnapshotSource.mockClear();
  stopSource.mockClear();
  useCameraStore.setState({ sourceState: { kind: 'idle' }, startSnapshotSource, stopSource });
});

afterEach(() => {
  useCameraStore.setState({
    sourceState: { kind: 'idle' },
    startSnapshotSource: original.startSnapshotSource,
    stopSource: original.stopSource,
  });
});

describe('PhoneCameraSection', () => {
  it('turns the address IP Webcam shows into its picture address', async () => {
    const host = await mountSection();
    expect(host.textContent).toContain('Mount the phone looking straight down');
    await typeAddress(host, 'admin:secret@192.168.1.50');
    await clickElement(button(host, 'Use phone'));
    expect(startSnapshotSource).toHaveBeenCalledWith(
      undefined,
      'http://admin:secret@192.168.1.50:8080/shot.jpg',
    );
    // The login is used for this connection but never stored.
    expect(loadPhoneCamera()).toEqual({ app: 'ip-webcam', address: '192.168.1.50' });
  });

  it('sends a video stream address to the RTSP section', async () => {
    const host = await mountSection();
    await chooseApp(host, 'other');
    await typeAddress(host, 'rtsp://192.168.1.60:8554/live');
    await clickElement(button(host, 'Use phone'));
    expect(startSnapshotSource).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Paste it under RTSP camera… instead.');
  });

  it('uses the complete query for this connection and explains that it is not remembered', async () => {
    const host = await mountSection();
    await chooseApp(host, 'other');
    const url = 'http://operator:password@192.168.1.50/frame?action=snapshot&token=secret';
    await typeAddress(host, url);
    await clickElement(button(host, 'Use phone'));
    expect(startSnapshotSource).toHaveBeenCalledWith(undefined, url);
    expect(loadPhoneCamera()).toEqual({ app: 'other', address: 'http://192.168.1.50/frame' });
    expect(host.textContent).toContain('Paste the full address again when reconnecting');
  });

  it('shows the running phone with its picture and a Stop button', async () => {
    savePhoneCamera({ app: 'ip-webcam', address: '192.168.1.50:8080' });
    useCameraStore.setState({ sourceState: liveStill(PHONE_URL) });
    const host = await mountSection();
    expect(host.querySelector('details')?.open).toBe(true);
    expect(host.querySelector('img')).not.toBeNull();
    await clickElement(button(host, 'Stop'));
    expect(stopSource).toHaveBeenCalledOnce();
  });

  it('does not claim the laser’s built-in camera as the phone', async () => {
    savePhoneCamera({ app: 'ip-webcam', address: '192.168.1.50:8080' });
    useCameraStore.setState({ sourceState: liveStill(FALCON_URL) });
    const host = await mountSection();
    expect(button(host, 'Use phone')).not.toBeNull();
    expect(host.querySelector('img')).toBeNull();
  });

  it('says why the phone did not start', async () => {
    useCameraStore.setState({
      sourceState: { kind: 'error', sourceKind: 'machine-jpeg', message: 'No picture.' },
    });
    const host = await mountSection();
    expect(host.textContent).toContain('No picture.');
    expect(button(host, 'Try again')).not.toBeNull();
  });
});

describe('MachineCameraSection with a phone running', () => {
  it('offers the built-in camera instead of marking it in use', async () => {
    useCameraStore.setState({ sourceState: liveStill(PHONE_URL) });
    const found = {
      kind: 'found',
      cameraUrl: FALCON_URL,
      proxyFrameUrl: `http://127.0.0.1:51731/frame.jpg?url=${encodeURIComponent(FALCON_URL)}`,
    } as const;
    const host = await mountControl(<MachineCameraSection state={found} onDetect={vi.fn()} />);
    expect(button(host, 'Use this camera')?.disabled).toBe(false);
    useCameraStore.setState({ sourceState: liveStill(FALCON_URL) });
    await act(async () => undefined);
    expect(button(host, 'In use')?.disabled).toBe(true);
  });
});
