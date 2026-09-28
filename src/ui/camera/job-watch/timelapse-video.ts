// A timelapse as a video file (ADR-490), made by the browser's own recorder:
// the frames are drawn one by one onto a canvas whose stream is recorded, at
// the video's frame rate, so making it takes as long as the video plays. MP4
// where the browser can record it (it plays everywhere), WebM otherwise.

import { TIMELAPSE_VIDEO_FPS } from '../../../core/camera/job-watch/timelapse-frames';

export type VideoFormat = { readonly mimeType: string; readonly extension: '.mp4' | '.webm' };

const FORMATS: ReadonlyArray<VideoFormat> = [
  { mimeType: 'video/mp4;codecs=avc1', extension: '.mp4' },
  { mimeType: 'video/mp4', extension: '.mp4' },
  { mimeType: 'video/webm;codecs=vp9', extension: '.webm' },
  { mimeType: 'video/webm;codecs=vp8', extension: '.webm' },
  { mimeType: 'video/webm', extension: '.webm' },
];

const VIDEO_BITS_PER_SECOND = 8_000_000;

/** The format this browser records, or null when it cannot record video. */
export function timelapseVideoFormat(): VideoFormat | null {
  if (typeof MediaRecorder === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null;
  return FORMATS.find((format) => MediaRecorder.isTypeSupported(format.mimeType)) ?? null;
}

type CanvasTrack = MediaStreamTrack & { requestFrame?: () => void };

/** The frames as one video, or null when recording failed. */
export async function encodeTimelapseVideo(
  frames: ReadonlyArray<Blob>,
  format: VideoFormat,
  onProgress: (done: number) => void,
  fps: number = TIMELAPSE_VIDEO_FPS,
): Promise<Blob | null> {
  const first = frames[0];
  if (first === undefined) return null;
  const size = await frameSize(first);
  if (size === null) return null;
  const canvas = document.createElement('canvas');
  // Video encoders want even sides.
  canvas.width = size.width - (size.width % 2);
  canvas.height = size.height - (size.height % 2);
  const context = canvas.getContext('2d');
  if (context === null) return null;
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasTrack | undefined;
  if (track?.requestFrame === undefined) return null;
  const recorder = new MediaRecorder(stream, {
    mimeType: format.mimeType,
    videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start();
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame !== undefined) await drawFrame(context, frame, canvas.width, canvas.height);
    track.requestFrame();
    onProgress(index + 1);
    await new Promise((resolve) => setTimeout(resolve, 1000 / fps));
  }
  recorder.stop();
  await stopped;
  track.stop();
  const type = format.mimeType.split(';')[0] ?? format.mimeType;
  return chunks.length > 0 ? new Blob(chunks, { type }) : null;
}

async function frameSize(frame: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(frame);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size.width >= 2 && size.height >= 2 ? size : null;
  } catch {
    return null;
  }
}

async function drawFrame(
  context: CanvasRenderingContext2D,
  frame: Blob,
  width: number,
  height: number,
): Promise<void> {
  try {
    const bitmap = await createImageBitmap(frame);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
  } catch {
    // An undecodable frame repeats the one before it.
  }
}
