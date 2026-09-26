// Keeps the bed overlay canvas drawn (ADR-440): owns the WebGL2 renderer for
// the canvas, redraws right after any render that changed the view, the
// opacity or the frame, and, for a live camera, on animation frames that show
// a new picture, so a still or a paused feed costs nothing between changes.
// The camera model is applied to the frame's real size on every draw, so a
// camera that changes resolution mid-session stays registered.

import { useEffect, useRef, useState } from 'react';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import type { ViewTransform } from '../../workspace/view-transform';
import { cameraModelForFrame } from '../camera-model-frame';
import type { LiveCaptureElement } from '../frame-capture';
import { cameraCaptureBindingForFrame, type ActiveCameraSource } from '../frame-source';
import type { CameraCaptureBinding } from '../../../core/camera/camera-capture-binding';
import { createBedOverlayRenderer, type BedOverlayRenderer } from './bed-overlay-renderer';
import { bedOverlayUniforms } from './bed-overlay-shader';

export type OverlayFrame =
  | {
      readonly kind: 'still';
      readonly image: RgbaImage;
      readonly capture: CameraCaptureBinding | null;
    }
  | {
      readonly kind: 'live';
      readonly element: LiveCaptureElement;
      readonly source: ActiveCameraSource;
    };

export type OverlayScene = {
  readonly model: CameraModelRecord;
  readonly view: ViewTransform;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
  readonly surfaceHeightMm: number;
  readonly opacity: number;
};

export type OverlayDrawingState = {
  /** The browser has no WebGL2, so the corrected picture cannot be drawn. */
  readonly unsupported: boolean;
  /** Why the current frame cannot be placed with the saved model, or null. */
  readonly issue: string | null;
};

type DrawInput = {
  readonly frame: OverlayFrame | null;
  readonly scene: OverlayScene | null;
};

export function useBedOverlayDrawing(
  canvas: HTMLCanvasElement | null,
  frame: OverlayFrame | null,
  scene: OverlayScene | null,
): OverlayDrawingState {
  const [renderer, setRenderer] = useState<BedOverlayRenderer | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const inputRef = useRef<DrawInput>({ frame, scene });

  useEffect(() => {
    if (canvas === null) return undefined;
    const created = createBedOverlayRenderer(canvas);
    setUnsupported(created === null);
    setRenderer(created);
    // The renderer rebuilds itself first (its listener is older); a still
    // then needs drawing again, as nothing else re-renders the overlay.
    const onRestored = (): void => {
      const input = inputRef.current;
      if (created !== null && !created.lost) {
        setIssue(drawOverlay(created, input.frame, input.scene));
      }
    };
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => {
      canvas.removeEventListener('webglcontextrestored', onRestored);
      created?.dispose();
      setRenderer(null);
    };
  }, [canvas]);

  // A new view, opacity or frame: draw it now.
  useEffect(() => {
    inputRef.current = { frame, scene };
    if (renderer !== null && !renderer.lost) setIssue(drawOverlay(renderer, frame, scene));
  }, [renderer, frame, scene]);

  const live = frame?.kind === 'live' ? frame.element : null;
  const streaming = frame?.kind === 'live' && frame.source.kind === 'machine-rtsp';
  useEffect(() => {
    if (renderer === null || live === null) return undefined;
    return watchLiveFrames(live, streaming, renderer, () => {
      const input = inputRef.current;
      setIssue(drawOverlay(renderer, input.frame, input.scene));
    });
  }, [renderer, live, streaming]);

  return { unsupported, issue };
}

// Redraws on animation frames that show a new picture, and once the context
// comes back after a loss.
function watchLiveFrames(
  element: LiveCaptureElement,
  streaming: boolean,
  renderer: BedOverlayRenderer,
  redraw: () => void,
): () => void {
  let handle = 0;
  let drawn = '';
  const tick = (): void => {
    handle = requestAnimationFrame(tick);
    if (renderer.lost) {
      drawn = '';
      return;
    }
    const key = liveFrameKey(element, streaming);
    if (key === drawn) return;
    drawn = key;
    redraw();
  };
  handle = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(handle);
}

/** Draw one overlay frame; the issue that kept it from drawing, or null. */
function drawOverlay(
  renderer: BedOverlayRenderer,
  frame: OverlayFrame | null,
  scene: OverlayScene | null,
): string | null {
  const size = frame === null ? null : frameSize(frame);
  if (frame === null || scene === null || size === null) {
    renderer.clear();
    return null;
  }
  const capture =
    frame.kind === 'still'
      ? frame.capture
      : cameraCaptureBindingForFrame(frame.source, size.width, size.height);
  const fitted = cameraModelForFrame(scene.model, capture, size.width, size.height);
  if (fitted.kind === 'issue') {
    renderer.clear();
    return fitted.message;
  }
  const pixelRatio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const uniforms = bedOverlayUniforms({
    lens: fitted.lens,
    pose: fitted.pose,
    surfaceHeightMm: scene.surfaceHeightMm,
    view: scene.view,
    canvasWidthPx: scene.cssWidth * pixelRatio,
    canvasHeightPx: scene.cssHeight * pixelRatio,
    devicePixelRatio: pixelRatio,
    bedWidthMm: scene.bedWidthMm,
    bedHeightMm: scene.bedHeightMm,
    opacity: scene.opacity,
  });
  renderer.draw(textureSource(frame), size.width, size.height, uniforms);
  return null;
}

function frameSize(
  frame: OverlayFrame,
): { readonly width: number; readonly height: number } | null {
  const size =
    frame.kind === 'still'
      ? { width: frame.image.width, height: frame.image.height }
      : frame.element instanceof HTMLVideoElement
        ? { width: frame.element.videoWidth, height: frame.element.videoHeight }
        : { width: frame.element.naturalWidth, height: frame.element.naturalHeight };
  return size.width > 0 && size.height > 0 ? size : null;
}

// Changes whenever the element shows a new picture: a video advances its
// clock, a polled image swaps or finishes its source. An MJPEG stream keeps
// one src and repaints in place, so it is sampled about 30 times a second.
function liveFrameKey(element: LiveCaptureElement, streaming: boolean): string {
  if (element instanceof HTMLVideoElement) {
    return `video:${element.currentTime}:${element.videoWidth}x${element.videoHeight}`;
  }
  const tick = streaming ? Math.floor(performance.now() / STREAM_FRAME_MS) : 0;
  return `image:${element.currentSrc}:${element.complete}:${element.naturalWidth}:${tick}`;
}

const STREAM_FRAME_MS = 33;

const stillTextures = new WeakMap<RgbaImage, ImageData>();

function textureSource(frame: OverlayFrame): TexImageSource {
  if (frame.kind === 'live') return frame.element;
  const cached = stillTextures.get(frame.image);
  if (cached !== undefined) return cached;
  const image = new ImageData(
    new Uint8ClampedArray(frame.image.data),
    frame.image.width,
    frame.image.height,
  );
  stillTextures.set(frame.image, image);
  return image;
}
