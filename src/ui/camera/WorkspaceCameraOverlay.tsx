// WorkspaceCameraOverlay — the camera picture drawn onto the workspace canvas
// through the saved camera model (ADR-107, ADR-440): every canvas pixel shows
// the camera pixel that sees that bed point at the material's surface height,
// so lens distortion and parallax are undone exactly and artwork can be placed
// over the real material. It shares the drawable stage's grid cell, measures
// its own box (the canvas's box) and recomputes the same fit-to-bed view the
// canvas renderer uses, so the picture tracks zoom and pan. Sources, in
// priority order: a captured still (LightBurn's Update Overlay model), else the
// live camera, whichever kind it is.

import { useMemo, useState } from 'react';
import type { CameraModelRecord } from '../../core/camera/model/camera-model-record';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useUiStore } from '../state/ui-store';
import { computeView } from '../workspace/view-transform';
import { CameraSourceView } from './CameraSourceView';
import type { LiveCaptureElement } from './frame-capture';
import {
  useBedOverlayDrawing,
  type OverlayFrame,
  type OverlayScene,
} from './overlay/use-bed-overlay-drawing';
import { useElementSize, type ElementSize } from './use-element-size';

export function WorkspaceCameraOverlay(): JSX.Element | null {
  const model = useStore((s) => s.project.device.cameraModel);
  const visible = useCameraStore((s) => s.overlayVisible);
  if (model === undefined || !visible) return null;
  return <ModelOverlay model={model} />;
}

function ModelOverlay(props: { readonly model: CameraModelRecord }): JSX.Element {
  const still = useCameraStore((s) => s.overlayStill);
  const stillCapture = useCameraStore((s) => s.overlayStillCapture);
  const sourceState = useCameraStore((s) => s.sourceState);
  const [box, boxRef] = useElementSize();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [liveElement, setLiveElement] = useState<LiveCaptureElement | null>(null);

  const liveSource = still === null && sourceState.kind === 'live' ? sourceState.source : null;
  const frame = useMemo<OverlayFrame | null>(() => {
    if (still !== null) return { kind: 'still', image: still, capture: stillCapture };
    if (liveSource === null || liveElement === null) return null;
    return { kind: 'live', element: liveElement, source: liveSource };
  }, [still, stillCapture, liveSource, liveElement]);
  const scene = useOverlayScene(props.model, box);
  const { unsupported, issue } = useBedOverlayDrawing(canvas, frame, scene);
  const notice = unsupported ? UNSUPPORTED_NOTICE : issue;

  return (
    <div ref={boxRef} style={boxStyle} aria-hidden={notice === null}>
      <canvas ref={setCanvas} style={canvasStyle} />
      {liveSource === null ? null : (
        // The live element only feeds the overlay's texture; it is never seen.
        <div style={hiddenSourceStyle}>
          <CameraSourceView source={liveSource} onElement={setLiveElement} />
        </div>
      )}
      {notice === null ? null : (
        <div role="status" style={noticeStyle}>
          {notice}
        </div>
      )}
    </div>
  );
}

function useOverlayScene(model: CameraModelRecord, box: ElementSize | null): OverlayScene | null {
  const bedWidthMm = useStore((s) => s.project.device.bedWidth);
  const bedHeightMm = useStore((s) => s.project.device.bedHeight);
  const opacityPercent = useCameraStore((s) => s.overlayOpacityPercent);
  const surfaceHeightMm = useCameraStore((s) => s.surfaceHeightMm);
  const zoomFactor = useUiStore((s) => s.zoomFactor);
  const panX = useUiStore((s) => s.panX);
  const panY = useUiStore((s) => s.panY);
  return useMemo(() => {
    if (box === null) return null;
    return {
      model,
      view: computeView(box.width, box.height, bedWidthMm, bedHeightMm, { zoomFactor, panX, panY }),
      cssWidth: box.width,
      cssHeight: box.height,
      bedWidthMm,
      bedHeightMm,
      surfaceHeightMm,
      opacity: opacityPercent / 100,
    };
  }, [
    model,
    box,
    bedWidthMm,
    bedHeightMm,
    opacityPercent,
    surfaceHeightMm,
    zoomFactor,
    panX,
    panY,
  ]);
}

const UNSUPPORTED_NOTICE =
  'This browser cannot draw the corrected camera picture because WebGL2 is turned off. Turn on graphics acceleration in the browser settings.';

// Under the floating panels (zIndex 5) and above the canvas; pointer-events
// none so all canvas interaction passes through untouched.
const boxStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
  zIndex: 1,
};
const canvasStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
};
// Kept rendered (a hidden or zero-size video can stop decoding) but invisible.
const hiddenSourceStyle: React.CSSProperties = {
  position: 'absolute',
  width: 2,
  height: 2,
  overflow: 'hidden',
  opacity: 0,
};
const noticeStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  maxWidth: '80%',
  padding: '4px 10px',
  borderRadius: 4,
  fontSize: 'var(--lf-text-sm)',
  background: 'var(--lf-bg-1)',
  color: 'var(--lf-warning-fg)',
  pointerEvents: 'none',
};
