import { describe, expect, it, vi } from 'vitest';
import { cameraStreamFromMediaStream } from './web-camera-stream';

type ControlledTrack = {
  readonly track: MediaStreamTrack;
  readonly setMuted: (muted: boolean) => void;
  readonly end: () => void;
  readonly stop: ReturnType<typeof vi.fn>;
};

function controlledTrack(settings: MediaTrackSettings = {}): ControlledTrack {
  const target = new EventTarget();
  let readyState: MediaStreamTrackState = 'live';
  let muted = false;
  const stop = vi.fn(() => {
    readyState = 'ended';
  });
  Object.assign(target, { stop, getSettings: () => settings });
  Object.defineProperties(target, {
    readyState: { get: () => readyState },
    muted: { get: () => muted },
  });
  return {
    // The fake implements only the MediaStreamTrack members this adapter reads.
    track: target as unknown as MediaStreamTrack,
    stop,
    setMuted: (next) => {
      muted = next;
      target.dispatchEvent(new Event(next ? 'mute' : 'unmute'));
    },
    end: () => {
      readyState = 'ended';
      target.dispatchEvent(new Event('ended'));
    },
  };
}

function mediaStream(tracks: ReadonlyArray<ControlledTrack>): MediaStream {
  return {
    getTracks: () => tracks.map((entry) => entry.track),
    getVideoTracks: () => tracks.map((entry) => entry.track),
  } as unknown as MediaStream;
}

describe('cameraStreamFromMediaStream', () => {
  it('reports temporary mute/unmute and terminal track end', () => {
    const controlled = controlledTrack({
      deviceId: 'cam-a',
      // Chromium exposes resizeMode even though it is not in TypeScript's
      // MediaTrackSettings declaration.
      resizeMode: 'none',
    } as MediaTrackSettings & { readonly resizeMode: string });
    const stream = cameraStreamFromMediaStream(mediaStream([controlled]), 'requested');
    const states: string[] = [];

    stream.onStatusChange?.((state) => states.push(state));
    controlled.setMuted(true);
    controlled.setMuted(false);
    controlled.end();

    expect(states).toEqual(['live', 'muted', 'live', 'ended']);
  });

  it('stops notifications after disposal and releases every track on stop', () => {
    const first = controlledTrack();
    const second = controlledTrack();
    const stream = cameraStreamFromMediaStream(mediaStream([first, second]), undefined);
    const changed = vi.fn();
    const dispose = stream.onStatusChange?.(changed);

    dispose?.();
    first.setMuted(true);
    expect(changed).toHaveBeenCalledTimes(1);

    stream.stop();
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(second.stop).toHaveBeenCalledTimes(1);
  });

  it('reports an already-ended stream immediately after subscription', () => {
    const controlled = controlledTrack();
    controlled.end();
    const stream = cameraStreamFromMediaStream(mediaStream([controlled]), undefined);
    const changed = vi.fn();

    stream.onStatusChange?.(changed);

    expect(changed).toHaveBeenCalledWith('ended');
  });
});
