// NetworkCameraView — the machine (Falcon) camera feed plus the 4-point bed
// alignment (ADR-107). The operator clicks the four bed corners in the live
// snapshot; the solved camera-pixel → bed-mm homography then warps the frame to
// a top-down "rectified" view (the bed flattened to a rectangle) via the shared
// overlayMatrix3d. Display-only CSS matrix3d on an <img>, so it stays CORS-safe.

import { type CSSProperties, useEffect, useRef, useState } from 'react';
import type { AlignmentState, Mat3 } from '../../core/camera';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { overlayMatrix3d } from './camera-overlay-transform';

const NETWORK_FRAME_INTERVAL_MS = 1500;
const PREVIEW_WIDTH_PX = 296;
const ALIGNMENT_CORNERS = 4;
const CORNER_LABELS: ReadonlyArray<string> = [
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-left',
];

type IntrinsicSize = { readonly width: number; readonly height: number };
type ClientRect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

/** Map a click on the displayed frame to a camera-intrinsic pixel, or null. */
export function clickToIntrinsicPixel(
  clientX: number,
  clientY: number,
  rect: ClientRect,
  natural: IntrinsicSize,
): { readonly x: number; readonly y: number } | null {
  if (rect.width === 0 || rect.height === 0) return null;
  if (natural.width === 0 || natural.height === 0) return null;
  // The frame renders object-fit:contain, so a natural aspect ≠ the element's
  // is letterboxed/pillarboxed. Map through the fitted content rect (centred,
  // aspect-preserved), not the full element, or a non-4:3 frame skews the
  // correspondence and mis-registers the overlay/trace.
  const contentW = Math.min(rect.width, (rect.height * natural.width) / natural.height);
  const contentH = Math.min(rect.height, (rect.width * natural.height) / natural.width);
  const localX = clientX - rect.left - (rect.width - contentW) / 2;
  const localY = clientY - rect.top - (rect.height - contentH) / 2;
  const EPS = 1e-6;
  // A click in a letterbox/pillarbox bar (outside the image) is not a point on
  // the frame — ignore it rather than snapping it to an edge.
  if (localX < -EPS || localX > contentW + EPS || localY < -EPS || localY > contentH + EPS) {
    return null;
  }
  return {
    x: (localX / contentW) * natural.width,
    y: (localY / contentH) * natural.height,
  };
}

export function NetworkCameraView(props: { readonly frameUrl: string }): JSX.Element {
  const device = useStore((s) => s.project.device);
  const alignment = useCameraStore((s) => s.alignment);
  const beginAlignment = useCameraStore((s) => s.beginAlignment);
  const addAlignmentPoint = useCameraStore((s) => s.addAlignmentPoint);
  const resetAlignment = useCameraStore((s) => s.resetAlignment);
  const tick = usePollTick();
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<IntrinsicSize | null>(null);

  const src = `${props.frameUrl}?t=${tick}`;
  const collecting = alignment.kind === 'collecting';

  const handleClick = (event: React.MouseEvent<HTMLImageElement>): void => {
    const img = imgRef.current;
    if (!collecting || natural === null || img === null) return;
    const point = clickToIntrinsicPixel(
      event.clientX,
      event.clientY,
      img.getBoundingClientRect(),
      natural,
    );
    if (point !== null) addAlignmentPoint(point);
  };

  const beginBedAlignment = (): void =>
    beginAlignment([
      { x: 0, y: 0 },
      { x: device.bedWidth, y: 0 },
      { x: device.bedWidth, y: device.bedHeight },
      { x: 0, y: device.bedHeight },
    ]);

  if (alignment.kind === 'aligned' && natural !== null) {
    return (
      <div style={columnStyle}>
        <RectifiedView
          src={src}
          natural={natural}
          homography={alignment.homography}
          bedWidth={device.bedWidth}
          bedHeight={device.bedHeight}
        />
        <span style={hintStyle}>Aligned — the bed is flattened to a rectangle.</span>
        <div style={rowStyle}>
          <SaveAlignmentButton homography={alignment.homography} natural={natural} />
          <button
            type="button"
            className="lf-btn"
            onClick={resetAlignment}
            title="Re-run the 4-point bed alignment."
          >
            Re-align
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={columnStyle}>
      <img
        ref={imgRef}
        src={src}
        alt="Laser machine camera"
        onLoad={(e) =>
          setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
        }
        onClick={handleClick}
        style={collecting ? { ...feedStyle, cursor: 'crosshair' } : feedStyle}
      />
      <AlignmentControls
        alignment={alignment}
        onBegin={beginBedAlignment}
        onReset={resetAlignment}
      />
    </div>
  );
}

// Persist the solved homography onto the device profile (undoable) so the
// workspace overlay survives reload. basis 'raw': the corners were clicked on
// the distorted frame, so only same-basis (raw) frames may be warped with it.
function SaveAlignmentButton(props: {
  readonly homography: Mat3;
  readonly natural: IntrinsicSize;
}): JSX.Element {
  const updateDeviceProfile = useStore((s) => s.updateDeviceProfile);
  const saved = useStore((s) => s.project.device.cameraAlignment);
  const isCurrent = saved !== undefined && saved.homography === props.homography;
  return (
    <button
      type="button"
      className="lf-btn lf-btn--primary"
      disabled={isCurrent}
      onClick={() =>
        updateDeviceProfile({
          cameraAlignment: {
            homography: props.homography,
            frameWidth: props.natural.width,
            frameHeight: props.natural.height,
            basis: 'raw',
            alignedAt: Date.now(),
          },
        })
      }
      title="Save this alignment to the device and show the camera on the workspace canvas."
    >
      {isCurrent ? 'Saved to device' : 'Save & show on canvas'}
    </button>
  );
}

function usePollTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), NETWORK_FRAME_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
  return tick;
}

function AlignmentControls(props: {
  readonly alignment: AlignmentState;
  readonly onBegin: () => void;
  readonly onReset: () => void;
}): JSX.Element {
  const { alignment } = props;
  if (alignment.kind === 'collecting') {
    const label = CORNER_LABELS[alignment.pixels.length] ?? 'next';
    return (
      <div style={columnStyle}>
        <span style={hintStyle}>
          Click the {label} bed corner ({alignment.pixels.length + 1} / {ALIGNMENT_CORNERS})
        </span>
        <button
          type="button"
          className="lf-btn"
          onClick={props.onReset}
          title="Cancel bed alignment and discard the corners clicked so far."
        >
          Cancel
        </button>
      </div>
    );
  }
  if (alignment.kind === 'failed') {
    return (
      <div style={columnStyle}>
        <span style={errStyle}>Couldn&apos;t align — the points were collinear. Try again.</span>
        <button
          type="button"
          className="lf-btn"
          onClick={props.onBegin}
          title="Try bed alignment again: click each bed corner in the camera view."
        >
          Align to bed
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="lf-btn"
      onClick={props.onBegin}
      title="Start the 4-point bed alignment: click each bed corner in the camera view."
    >
      Align to bed
    </button>
  );
}

function RectifiedView(props: {
  readonly src: string;
  readonly natural: IntrinsicSize;
  readonly homography: Mat3;
  readonly bedWidth: number;
  readonly bedHeight: number;
}): JSX.Element {
  const scale = PREVIEW_WIDTH_PX / props.bedWidth;
  const matrix = overlayMatrix3d(props.homography, { scale, offsetX: 0, offsetY: 0 }).join(', ');
  return (
    <div
      style={{
        position: 'relative',
        width: PREVIEW_WIDTH_PX,
        height: props.bedHeight * scale,
        overflow: 'hidden',
        background: 'var(--lf-bg-2)',
        borderRadius: 4,
      }}
    >
      <img
        src={props.src}
        alt="Rectified bed view"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${props.natural.width}px`,
          height: `${props.natural.height}px`,
          transformOrigin: '0 0',
          transform: `matrix3d(${matrix})`,
        }}
      />
    </div>
  );
}

const columnStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const rowStyle: CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const feedStyle: CSSProperties = {
  width: '100%',
  aspectRatio: '4 / 3',
  background: 'var(--lf-bg-2)',
  borderRadius: 4,
  objectFit: 'contain',
};
const hintStyle: CSSProperties = { fontSize: 12, color: 'var(--lf-text-faint)' };
const errStyle: CSSProperties = { fontSize: 12, color: 'var(--lf-danger)' };
