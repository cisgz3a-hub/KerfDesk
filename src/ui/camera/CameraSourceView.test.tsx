import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveCameraSource } from './frame-source';
import { CameraSourceView } from './CameraSourceView';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RTSP_SOURCE: ActiveCameraSource = {
  kind: 'machine-rtsp',
  frameUrl: 'http://127.0.0.1:51731/frame.jpg?url=x',
  previewUrl: 'http://127.0.0.1:51731/stream.mjpg?url=x',
  streamSessionId: 'session-a',
  sourceId: 'rtsp://192.168.10.1:8554/',
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('CameraSourceView RTSP lifecycle', () => {
  it('reports an MJPEG preview failure to its source owner', () => {
    const onFailure = vi.fn();
    act(() => root.render(<CameraSourceView source={RTSP_SOURCE} onFailure={onFailure} />));

    const image = host.querySelector('img');
    expect(image).not.toBeNull();
    act(() => {
      image?.dispatchEvent(new Event('error'));
    });

    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('does not promise an automatic retry when no owner callback is present', () => {
    act(() => root.render(<CameraSourceView source={RTSP_SOURCE} />));

    act(() => {
      host.querySelector('img')?.dispatchEvent(new Event('error'));
    });

    expect(host.textContent).toContain('reconnect');
    expect(host.textContent).not.toContain('will retry');
  });
});
