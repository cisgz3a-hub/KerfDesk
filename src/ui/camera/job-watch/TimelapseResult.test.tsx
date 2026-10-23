import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installChromiumSavePicker,
  lapseUserActivation,
  type ChromiumSavePicker,
} from '../../../platform/web/chromium-save-picker.test-support';
import { webAdapter } from '../../../platform/web/web-adapter';
import { PlatformProvider } from '../../app/platform-context';
import { useSaveReadyDialogStore } from '../../state/save-ready-dialog-store';
import { useToastStore } from '../../state/toast-store';
import { TimelapseResult } from './TimelapseResult';

const video = vi.hoisted(() => ({ encode: vi.fn<() => Promise<Blob | null>>() }));
vi.mock('./timelapse-video', () => ({
  timelapseVideoFormat: () => ({ mimeType: 'video/webm', extension: '.webm' }),
  encodeTimelapseVideo: video.encode,
}));
vi.mock('./TimelapsePlayer', () => ({ TimelapsePlayer: () => null }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let picker: ChromiumSavePicker | null = null;
let restoreActivation: (() => void) | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  picker?.restore();
  picker = null;
  restoreActivation?.();
  restoreActivation = null;
  useSaveReadyDialogStore.setState({ request: null });
  useToastStore.setState({ toasts: [] });
  video.encode.mockReset();
});

async function clickSaveVideo(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const timelapse = {
    frames: [new Blob(['frame'])],
    intervalMs: 5000,
    flat: false,
    recording: false,
    note: null,
  };
  await act(async () =>
    root?.render(
      <PlatformProvider adapter={webAdapter}>
        <TimelapseResult timelapse={timelapse} />
      </PlatformProvider>,
    ),
  );
  const button = [...host.querySelectorAll('button')].find(
    (node) => node.textContent === 'Save video…',
  );
  if (button === undefined) throw new Error('Save video button missing');
  await act(async () => button.click());
}

// Audit 19-P2-1 / ADR-656: Chromium empties the chosen file as its save picker
// returns, so the long encode runs before the picker opens.
describe('timelapse Save video over an existing file', () => {
  it('keeps the old video when encoding fails, without opening the picker', async () => {
    const disk = new Map([['timelapse.webm', 'previous video']]);
    picker = installChromiumSavePicker(disk);
    video.encode.mockResolvedValue(null);

    await clickSaveVideo();

    await vi.waitFor(() =>
      expect(useToastStore.getState().toasts).toContainEqual(
        expect.objectContaining({ message: 'Could not make the timelapse video.' }),
      ),
    );
    expect(picker.picks()).toBe(0);
    expect(disk.get('timelapse.webm')).toBe('previous video');
  });

  it('re-enables Save when the recorder throws instead of leaving it stuck', async () => {
    const disk = new Map([['timelapse.webm', 'previous video']]);
    picker = installChromiumSavePicker(disk);
    video.encode.mockRejectedValue(new DOMException('Recorder failed', 'NotSupportedError'));

    await clickSaveVideo();

    await vi.waitFor(() =>
      expect(useToastStore.getState().toasts).toContainEqual(
        expect.objectContaining({ message: 'Could not make the timelapse video.' }),
      ),
    );
    const button = [...(host?.querySelectorAll('button') ?? [])].find(
      (node) => node.textContent === 'Save video…',
    );
    expect(button?.disabled).toBe(false);
    expect(picker.picks()).toBe(0);
    expect(disk.get('timelapse.webm')).toBe('previous video');
  });

  it('asks for a fresh Choose file click after a long encode, then saves', async () => {
    const disk = new Map([['timelapse.webm', 'previous video']]);
    picker = installChromiumSavePicker(disk);
    restoreActivation = lapseUserActivation();
    video.encode.mockResolvedValue(new Blob(['new video']));

    await clickSaveVideo();
    await vi.waitFor(() =>
      expect(useSaveReadyDialogStore.getState().request?.title).toBe('Save timelapse video'),
    );
    expect(picker.picks()).toBe(0);
    expect(disk.get('timelapse.webm')).toBe('previous video');

    await act(async () => useSaveReadyDialogStore.getState().request?.choose());
    await vi.waitFor(() => expect(disk.get('timelapse.webm')).toBe('new video'));
  });
});
