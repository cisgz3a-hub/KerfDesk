import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useCameraStore } from '../../state/camera-store';
import { RtspSourceControls } from './RtspSourceControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ADVISORY =
  'This camera bridge does not report RTSP preview liveness. The preview remains available.';

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useCameraStore.setState({
    sourceState: {
      kind: 'live',
      source: {
        kind: 'machine-rtsp',
        frameUrl: 'http://127.0.0.1:51731/frame.jpg?url=x',
        previewUrl: 'http://127.0.0.1:51731/stream.mjpg?url=x',
        liveness: { kind: 'unmonitored', advisory: ADVISORY },
        sourceId: 'rtsp://192.168.10.1/live',
      },
    },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('RtspSourceControls legacy bridge advisory', () => {
  it('keeps the preview and Stop action available while labeling liveness unmonitored', () => {
    act(() => {
      root.render(
        <PlatformProvider adapter={platform}>
          <RtspSourceControls />
        </PlatformProvider>,
      );
    });

    expect(container.textContent).toContain(ADVISORY);
    expect(container.querySelector('img')).not.toBeNull();
    const stop = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Stop',
    );
    expect(stop?.disabled).toBe(false);
  });
});
