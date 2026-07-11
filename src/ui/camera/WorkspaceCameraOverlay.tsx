// WorkspaceCameraOverlay — the persisted camera→bed alignment projected onto
// the workspace canvas (ADR-107: the overlay that finally lets the operator
// place artwork over the REAL material). Mounts as a canvas-area sibling
// (Workspace stays untouched); it measures its own box — which is the canvas's
// box — and recomputes the same fit-to-bed view the canvas renderer uses, so
// the warped frame tracks zoom and pan exactly. Sources, in priority order:
// a captured still (LightBurn's Update Overlay model), else the live video.

import { useEffect, useRef, useState } from 'react';
import { scaleAlignmentHomographyToFrame, type RgbaImage } from '../../core/camera';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useUiStore } from '../state/ui-store';
import { computeView } from '../workspace/view-transform';
import { CameraOverlay } from './CameraOverlay';
import { overlayMatrix3d } from './camera-overlay-transform';

export function WorkspaceCameraOverlay(): JSX.Element | null {
  const alignment = useStore((s) => s.project.device.cameraAlignment);
  const bedWidth = useStore((s) => s.project.device.bedWidth);
  const bedHeight = useStore((s) => s.project.device.bedHeight);
  const visible = useCameraStore((s) => s.overlayVisible);
  const opacityPercent = useCameraStore((s) => s.overlayOpacityPercent);
  const still = useCameraStore((s) => s.overlayStill);
  const sourceState = useCameraStore((s) => s.sourceState);
  const zoomFactor = useUiStore((s) => s.zoomFactor);
  const panX = useUiStore((s) => s.panX);
  const panY = useUiStore((s) => s.panY);
  const [box, boxRef] = useElementSize();

  if (alignment === undefined || !visible) return null;
  // Live overlay needs a MediaStream (USB); machine sources overlay via the
  // captured still (LightBurn's Update Overlay model).
  const liveStream =
    sourceState.kind === 'live' && sourceState.source.kind === 'usb'
      ? sourceState.source.stream.stream
      : null;
  const hasSource = still !== null || liveStream !== null;
  if (!hasSource) return null;

  const view =
    box === null
      ? null
      : computeView(box.width, box.height, bedWidth, bedHeight, { zoomFactor, panX, panY });
  return (
    <div ref={boxRef} style={boxStyle} aria-hidden="true">
      {view === null ? null : still !== null ? (
        <StillOverlay
          still={still}
          // Rescale to the still's own resolution (it may differ from the
          // calibration frame), matching the Trace path (Codex audit P2).
          matrix={overlayMatrix3d(
            scaleAlignmentHomographyToFrame(alignment, still.width, still.height),
            view,
          )}
          opacityPercent={opacityPercent}
        />
      ) : liveStream !== null ? (
        <CameraOverlay
          stream={liveStream}
          alignment={alignment}
          view={view}
          opacityPercent={opacityPercent}
        />
      ) : null}
    </div>
  );
}

function StillOverlay(props: {
  readonly still: RgbaImage;
  readonly matrix: ReadonlyArray<number>;
  readonly opacityPercent: number;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.width = props.still.width;
    canvas.height = props.still.height;
    const context = canvas.getContext('2d');
    if (context === null) return;
    context.putImageData(
      new ImageData(new Uint8ClampedArray(props.still.data), props.still.width, props.still.height),
      0,
      0,
    );
  }, [props.still]);
  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        transformOrigin: '0 0',
        transform: `matrix3d(${props.matrix.join(', ')})`,
        opacity: props.opacityPercent / 100,
        pointerEvents: 'none',
      }}
    />
  );
}

// The overlay box fills the canvas area, so its measured CSS size equals the
// workspace canvas's bitmap size (the canvas is deliberately not DPR-scaled).
function useElementSize(): [
  { readonly width: number; readonly height: number } | null,
  (node: HTMLDivElement | null) => void,
] {
  const [size, setSize] = useState<{ readonly width: number; readonly height: number } | null>(
    null,
  );
  const observerRef = useRef<ResizeObserver | null>(null);
  const setNode = (node: HTMLDivElement | null): void => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (node === null) return;
    const apply = (): void => {
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      setSize((current) =>
        current !== null && current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    observerRef.current = observer;
  };
  return [size, setNode];
}

// Under the floating panels (zIndex 5) and above the canvas; pointer-events
// none so all canvas interaction passes through untouched.
const boxStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
  zIndex: 1,
};
