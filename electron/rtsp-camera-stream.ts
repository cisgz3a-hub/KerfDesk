// The ffmpeg half of the camera bridge: transcode a private-network RTSP
// stream into browser-renderable MJPEG. Split from rtsp-camera-bridge.ts so
// the HTTP server owns routing/policy and this module owns the ffmpeg process
// lifecycle (spawn, backpressure, teardown, concurrency accounting).

import { spawn } from 'node:child_process';
import type { ServerResponse } from 'node:http';
import { writeJson } from './bridge-json.js';

// Bound concurrent ffmpeg transcodes so a burst of stream requests cannot
// exhaust the machine (S03-001 DoS hardening).
const MAX_CONCURRENT_FFMPEG = 4;
let activeFfmpegCount = 0;

/** True when another ffmpeg transcode may start (S03-001 concurrency bound). */
export function hasFreeFfmpegSlot(): boolean {
  return activeFfmpegCount < MAX_CONCURRENT_FFMPEG;
}

// Reserve a concurrency slot for one ffmpeg transcode; returns an idempotent
// release. Keeps the streamWithFfmpeg accounting to a single line (S03-001).
function acquireFfmpegSlot(): () => void {
  activeFfmpegCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeFfmpegCount -= 1;
  };
}

export function streamWithFfmpeg(url: URL, res: ServerResponse): void {
  const ffmpeg = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-rtsp_transport',
    'tcp',
    '-i',
    url.toString(),
    '-an',
    '-vf',
    'fps=10',
    '-f',
    'mpjpeg',
    '-q:v',
    '5',
    'pipe:1',
  ]);
  const releaseSlot = acquireFfmpegSlot();
  const stderrChunks: Buffer[] = [];
  let clientClosed = false;
  let responseStarted = false;
  let settled = false;

  const startupTimer = setTimeout(() => {
    failStream(new Error('FFmpeg did not produce camera preview data.'));
  }, 10000);

  const cleanup = (): void => {
    clearTimeout(startupTimer);
  };

  const failStream = (err: Error): void => {
    if (settled) return;
    settled = true;
    cleanup();
    ffmpeg.kill('SIGTERM');
    if (clientClosed) return;
    if (responseStarted || res.headersSent) {
      res.destroy(err);
      return;
    }
    writeJson(res, { kind: 'unavailable', reason: err.message }, 502);
  };

  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    appendLimitedStderrChunk(stderrChunks, chunk);
  });
  ffmpeg.stdout.on('data', (chunk: Buffer) => {
    if (settled || clientClosed) return;
    if (!responseStarted) {
      responseStarted = true;
      cleanup();
      writeMjpegResponseHeaders(res);
    }
    if (!res.write(chunk)) ffmpeg.stdout.pause();
  });
  ffmpeg.stdout.on('end', () => {
    if (!settled && responseStarted && !clientClosed) res.end();
  });
  res.on('drain', () => ffmpeg.stdout.resume());
  res.on('close', () => {
    clientClosed = true;
    settled = true;
    cleanup();
    ffmpeg.kill('SIGTERM');
  });
  ffmpeg.on('error', (err) => {
    releaseSlot();
    failStream(err);
  });
  ffmpeg.on('exit', (code, signal) => {
    releaseSlot();
    if (settled) return;
    if (code === 0 || signal === 'SIGTERM') {
      settled = true;
      cleanup();
      if (responseStarted && !clientClosed) res.end();
      return;
    }
    failStream(new Error(ffmpegFailureReason(stderrChunks, 'FFmpeg camera preview failed.')));
  });
}

function appendLimitedStderrChunk(chunks: Buffer[], chunk: Buffer): void {
  if (Buffer.concat(chunks).length < 8192) chunks.push(Buffer.from(chunk));
}

function writeMjpegResponseHeaders(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=ffmpeg',
    'Cache-Control': 'no-store',
  });
}

export function ffmpegFailureReason(chunks: ReadonlyArray<Buffer>, fallback: string): string {
  const stderr = Buffer.concat(chunks).toString('utf8').trim();
  return stderr.length > 0 ? `${fallback}: ${stderr}` : fallback;
}

const SINGLE_FRAME_TIMEOUT_MS = 10000;
const MAX_SINGLE_FRAME_BYTES = 8 * 1024 * 1024;

export type RtspFrameCaptureResult =
  | { readonly kind: 'ok'; readonly jpeg: Buffer }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * Decode exactly one JPEG frame from a private-network RTSP camera (ADR-116).
 * Still capture must not depend on the browser's MJPEG-in-canvas semantics,
 * so the /frame.jpg route asks ffmpeg for a single image instead.
 */
export function captureRtspFrameJpeg(url: URL): Promise<RtspFrameCaptureResult> {
  if (!hasFreeFfmpegSlot()) {
    return Promise.resolve({ kind: 'failed', reason: 'Too many concurrent camera streams.' });
  }
  const releaseSlot = acquireFfmpegSlot();
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-rtsp_transport',
      'tcp',
      '-i',
      url.toString(),
      '-an',
      '-frames:v',
      '1',
      '-f',
      'image2',
      '-q:v',
      '4',
      'pipe:1',
    ]);
    const out: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outBytes = 0;
    let settled = false;
    const finish = (result: RtspFrameCaptureResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      releaseSlot();
      resolve(result);
    };
    const timer = setTimeout(() => {
      ffmpeg.kill('SIGTERM');
      finish({ kind: 'failed', reason: 'FFmpeg did not produce a camera frame in time.' });
    }, SINGLE_FRAME_TIMEOUT_MS);
    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > MAX_SINGLE_FRAME_BYTES) {
        ffmpeg.kill('SIGTERM');
        finish({ kind: 'failed', reason: 'Camera frame is too large.' });
        return;
      }
      out.push(Buffer.from(chunk));
    });
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      appendLimitedStderrChunk(stderrChunks, chunk);
    });
    ffmpeg.on('error', (err) => {
      finish({ kind: 'failed', reason: err.message });
    });
    ffmpeg.on('exit', (code) => {
      if (code === 0 && out.length > 0) {
        finish({ kind: 'ok', jpeg: Buffer.concat(out) });
        return;
      }
      finish({
        kind: 'failed',
        reason: ffmpegFailureReason(stderrChunks, 'FFmpeg could not capture a camera frame.'),
      });
    });
  });
}

let ffmpegAvailable: Promise<boolean> | null = null;

export function hasFfmpeg(): Promise<boolean> {
  ffmpegAvailable ??= new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    ffmpeg.on('error', () => resolve(false));
    ffmpeg.on('exit', (code) => resolve(code === 0));
  });
  return ffmpegAvailable;
}
