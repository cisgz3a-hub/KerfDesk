import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkCameraView } from './NetworkCameraView';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The bridge names a registered camera by an id, never by its address (audit v2 04-P2-1).
function frameUrl(sourceId: string): string {
  return `http://127.0.0.1:51731/frame.jpg?source=${encodeURIComponent(sourceId)}`;
}

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
  it.each(['9f1c2b6e-3d4a-4e5f-8a9b-0c1d2e3f4a5b', 'a+b?c&d'])(
    'keeps the bridge camera source unchanged across polls: %s',
    (sourceId) => {
      act(() => root.render(<NetworkCameraView frameUrl={frameUrl(sourceId)} />));
      const first = previewUrl();
      expect(first.searchParams.get('source')).toBe(sourceId);
      expect(first.searchParams.has('t')).toBe(true);

      // This unchanged source lets a slower camera's next poll join the
      // bridge's existing fetch rather than queue a different camera URL.
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      const second = previewUrl();
      expect(second.searchParams.get('source')).toBe(sourceId);
      expect(second.searchParams.get('t')).not.toBe(first.searchParams.get('t'));
    },
  );

  it('does not restart the image request when its parent rerenders between polls', () => {
    const url = frameUrl('photo');
    act(() => root.render(<NetworkCameraView frameUrl={url} />));
    const first = previewUrl().href;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => root.render(<NetworkCameraView frameUrl={url} />));
    expect(previewUrl().href).toBe(first);
  });

  it('switches to a replacement camera without retaining the previous source', () => {
    act(() => root.render(<NetworkCameraView frameUrl={frameUrl('first')} />));
    act(() => root.render(<NetworkCameraView frameUrl={frameUrl('second')} />));
    expect(previewUrl().searchParams.get('source')).toBe('second');
  });
});
