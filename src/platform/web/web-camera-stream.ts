import type { CameraStream, CameraStreamStatus } from '../types';

/** Wrap a browser MediaStream with identity, lifecycle observation, and release. */
export function cameraStreamFromMediaStream(
  stream: MediaStream,
  requestedDeviceId: string | undefined,
): CameraStream {
  const settings = stream.getVideoTracks()[0]?.getSettings();
  return {
    stream,
    sourceId: settings?.deviceId || requestedDeviceId || 'default-camera',
    resizeMode: normalizeResizeMode(
      (settings as (MediaTrackSettings & { readonly resizeMode?: string }) | undefined)?.resizeMode,
    ),
    onStatusChange: (handler) => observeTrackStatus(stream.getVideoTracks(), handler),
    stop: () => {
      for (const track of stream.getTracks()) track.stop();
    },
  };
}

function observeTrackStatus(
  tracks: ReadonlyArray<MediaStreamTrack>,
  handler: (status: CameraStreamStatus) => void,
): () => void {
  let previous = trackStatus(tracks);
  const notify = (): void => {
    const current = trackStatus(tracks);
    if (current === previous) return;
    previous = current;
    handler(current);
  };
  for (const track of tracks) {
    track.addEventListener('mute', notify);
    track.addEventListener('unmute', notify);
    track.addEventListener('ended', notify);
  }
  handler(previous);
  return () => {
    for (const track of tracks) {
      track.removeEventListener('mute', notify);
      track.removeEventListener('unmute', notify);
      track.removeEventListener('ended', notify);
    }
  };
}

function trackStatus(tracks: ReadonlyArray<MediaStreamTrack>): CameraStreamStatus {
  const liveTracks = tracks.filter((track) => track.readyState === 'live');
  if (liveTracks.length === 0) return 'ended';
  return liveTracks.some((track) => !track.muted) ? 'live' : 'muted';
}

function normalizeResizeMode(value: string | undefined): CameraStream['resizeMode'] {
  if (value === 'none' || value === 'crop-and-scale') return value;
  return 'unknown';
}
