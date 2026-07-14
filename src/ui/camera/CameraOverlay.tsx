// CameraOverlay — the live overhead-camera frame (ADR-107), warped by the
// solved homography so it registers on the rendered bed. The <video> is sized
// to its intrinsic camera-pixel dimensions (the homography's source basis) and
// transformed with a single CSS matrix3d (transform-origin 0 0). It is purely
// decorative (pointer-events: none, aria-hidden) and sits under the workspace
// overlays. The wiring slice positions it over the canvas and feeds the view.

import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { scaleAlignmentHomographyToFrame, type CameraAlignment } from '../../core/camera';
import type { CameraCaptureBinding } from '../../core/camera/camera-capture-binding';
import type { ViewTransform } from '../workspace/view-transform';
import { overlayMatrix3d } from './camera-overlay-transform';
import { cameraBindingIssue } from './camera-binding-guard';

type CameraOverlayProps = {
  readonly stream: MediaStream;
  readonly alignment: CameraAlignment;
  readonly view: ViewTransform;
  readonly opacityPercent: number;
  readonly cssScale?: number;
  readonly captureBinding: CameraCaptureBinding | null;
};

type FrameSize = { readonly width: number; readonly height: number };

export function CameraOverlay(props: CameraOverlayProps): JSX.Element {
  const { stream, alignment, view, opacityPercent, captureBinding, cssScale = 1 } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [frame, setFrame] = useState<FrameSize | null>(null);
  // The homography was solved in the calibration frame's pixel basis; a live
  // stream at a different resolution must be rescaled to it, exactly as the
  // Trace path does (trace-from-camera.ts) — otherwise the warped frame is off
  // by the resolution ratio (Codex audit P2).
  const homography =
    frame === null
      ? alignment.homography
      : scaleAlignmentHomographyToFrame(alignment, frame.width, frame.height);
  const currentCapture =
    frame === null || captureBinding === null
      ? null
      : { ...captureBinding, width: frame.width, height: frame.height };
  const bindingIssue =
    currentCapture === null
      ? null
      : cameraBindingIssue('bed alignment', alignment.capture, currentCapture);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return undefined;
    video.srcObject = stream;
    void video.play().catch(() => {
      // Autoplay can reject before a user gesture; the frame still attaches.
    });
    return () => {
      // Detach so the browser releases the stream and the last frame clears.
      video.srcObject = null;
    };
  }, [stream]);

  const size: CSSProperties =
    frame === null ? {} : { width: `${frame.width}px`, height: `${frame.height}px` };

  if (bindingIssue !== null) return <div style={noticeStyle}>{bindingIssue}</div>;

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      aria-hidden="true"
      onLoadedMetadata={(e) =>
        setFrame({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })
      }
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        transformOrigin: '0 0',
        transform: `matrix3d(${overlayMatrix3d(homography, view, cssScale).join(', ')})`,
        opacity: opacityPercent / 100,
        pointerEvents: 'none',
        ...size,
      }}
    />
  );
}

const noticeStyle: React.CSSProperties = {
  padding: '4px 10px',
  background: 'var(--lf-bg-1)',
  color: 'var(--lf-warning-fg)',
};
