// CameraSourceView — the one live surface for any ActiveCameraSource
// (ADR-116): a <video> for USB streams, a polled <img> for machine snapshot
// cameras, a continuous MJPEG <img> for bridge RTSP previews. Machine images
// load with crossOrigin="anonymous" against the bridge (which sends CORS for
// this origin), so callers may draw the element to a canvas for detection
// without tainting it. `onElement` hands the live element to such callers.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { assertNever } from '../../core/scene';
import {
  MACHINE_JPEG_POLL_INTERVAL_MS,
  withCacheBuster,
  type ActiveCameraSource,
} from './frame-source';
import type { LiveCaptureElement } from './frame-capture';

export function CameraSourceView(props: {
  readonly source: ActiveCameraSource;
  readonly onElement?: ((element: LiveCaptureElement | null) => void) | undefined;
}): JSX.Element {
  const { source, onElement } = props;
  switch (source.kind) {
    case 'usb':
      return <UsbVideo stream={source.stream.stream} onElement={onElement} />;
    case 'machine-jpeg':
      return <PolledJpeg url={source.frameUrl} onElement={onElement} />;
    case 'machine-rtsp':
      return <MjpegImage url={source.previewUrl} onElement={onElement} />;
    default:
      return assertNever(source, 'camera source');
  }
}

function UsbVideo(props: {
  readonly stream: MediaStream;
  readonly onElement?: ((element: LiveCaptureElement | null) => void) | undefined;
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { stream, onElement } = props;
  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return undefined;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    onElement?.(video);
    return () => {
      onElement?.(null);
      video.srcObject = null;
    };
  }, [stream, onElement]);
  return <video ref={videoRef} autoPlay muted playsInline style={surfaceStyle} />;
}

function PolledJpeg(props: {
  readonly url: string;
  readonly onElement?: ((element: LiveCaptureElement | null) => void) | undefined;
}): JSX.Element {
  const tick = usePollTick(MACHINE_JPEG_POLL_INTERVAL_MS);
  // The buster is derived from the tick so React only swaps src per poll.
  const [src, setSrc] = useState(props.url);
  useEffect(() => {
    setSrc(withCacheBuster(props.url));
  }, [props.url, tick]);
  return <CapturableImage src={src} alt="Machine camera" onElement={props.onElement} />;
}

function MjpegImage(props: {
  readonly url: string;
  readonly onElement?: ((element: LiveCaptureElement | null) => void) | undefined;
}): JSX.Element {
  return (
    <CapturableImage src={props.url} alt="Machine camera stream" onElement={props.onElement} />
  );
}

function CapturableImage(props: {
  readonly src: string;
  readonly alt: string;
  readonly onElement?: ((element: LiveCaptureElement | null) => void) | undefined;
}): JSX.Element {
  const { onElement } = props;
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    onElement?.(imgRef.current);
    return () => onElement?.(null);
  }, [onElement]);
  return (
    <img
      ref={imgRef}
      crossOrigin="anonymous"
      src={props.src}
      alt={props.alt}
      style={surfaceStyle}
    />
  );
}

function usePollTick(intervalMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

const surfaceStyle: CSSProperties = {
  width: '100%',
  aspectRatio: '4 / 3',
  background: 'var(--lf-bg-2)',
  borderRadius: 4,
  objectFit: 'contain',
};
