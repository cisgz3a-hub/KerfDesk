import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHttpCameraBridge } from '../../platform/web/camera-bridge';
import { NetworkCameraView } from './NetworkCameraView';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const bridge = createHttpCameraBridge();
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function previewUrl(): URL {
  const image = host.querySelector('img');
  if (image === null) throw new Error('Missing camera preview');
  return new URL(image.src);
}

describe('NetworkCameraView preview requests', () => {
  it.each([
    'http://192.168.10.1:8080/media/getCapturePhoto',
    'http://192.168.10.1:8080/photo?channel=1&token=a%2Bb%3Fc%26d',
  ])('keeps the bridge camera address unchanged across polls: %s', (cameraUrl) => {
    act(() => root.render(<NetworkCameraView frameUrl={bridge.proxiedFrameUrl(cameraUrl)} />));
    const first = previewUrl();
    expect(first.searchParams.get('url')).toBe(cameraUrl);
    expect(first.searchParams.has('t')).toBe(true);

    // This unchanged upstream address lets a slower camera's next poll join
    // the bridge's existing fetch rather than queue a different camera URL.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    const second = previewUrl();
    expect(second.searchParams.get('url')).toBe(cameraUrl);
    expect(second.searchParams.get('t')).not.toBe(first.searchParams.get('t'));
  });

  it('does not restart the image request when its parent rerenders between polls', () => {
    const frameUrl = bridge.proxiedFrameUrl('http://192.168.10.1:8080/photo');
    act(() => root.render(<NetworkCameraView frameUrl={frameUrl} />));
    const first = previewUrl().href;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => root.render(<NetworkCameraView frameUrl={frameUrl} />));
    expect(previewUrl().href).toBe(first);
  });

  it('switches to a replacement camera without retaining the previous nested address', () => {
    const first = 'http://192.168.10.1:8080/photo';
    const second = 'http://192.168.10.2:8080/photo?channel=2';
    act(() => root.render(<NetworkCameraView frameUrl={bridge.proxiedFrameUrl(first)} />));
    act(() => root.render(<NetworkCameraView frameUrl={bridge.proxiedFrameUrl(second)} />));
    expect(previewUrl().searchParams.get('url')).toBe(second);
  });
});
