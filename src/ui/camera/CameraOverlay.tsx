// CameraOverlay — the live overhead-camera frame (ADR-105), warped by the
// solved homography so it registers on the rendered bed. The <video> is sized
// to its intrinsic camera-pixel dimensions (the homography's source basis) and
// transformed with a single CSS matrix3d (transform-origin 0 0). It is purely
// decorative (pointer-events: none, aria-hidden) and sits under the workspace
// overlays. The wiring slice positions it over the canvas and feeds the view.

import { type CSSProperties, useEffect, useRef, useState } from 'react';
import type { Mat3 } from '../../core/camera';
import type { ViewTransform } from '../workspace/view-transform';
import { overlayMatrix3d } from './camera-overlay-transform';

type CameraOverlayProps = {
  readonly stream: MediaStream;
  readonly homography: Mat3;
  readonly view: ViewTransform;
  readonly opacityPercent: number;
  readonly cssScale?: number;
};

type FrameSize = { readonly width: number; readonly height: number };

export function CameraOverlay(props: CameraOverlayProps): JSX.Element {
  const { stream, homography, view, opacityPercent, cssScale = 1 } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [frame, setFrame] = useState<FrameSize | null>(null);

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
