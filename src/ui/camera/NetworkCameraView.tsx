// NetworkCameraView — the machine (Falcon) camera's live preview in the
// Camera panel, polled through the bridge. Placing the picture on the bed is
// the camera model's job (ADR-440): the old four-corner click alignment is
// gone, since one engraved-target photo now calibrates lens and position.
// `clickToIntrinsicPixel` maps a click on a contain-fitted frame back to a
// camera pixel, for tools that let the operator point at the picture.

import { type CSSProperties, useEffect, useState } from 'react';

const NETWORK_FRAME_INTERVAL_MS = 1500;

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
  const tick = usePollTick();
  return <img src={`${props.frameUrl}?t=${tick}`} alt="Laser machine camera" style={feedStyle} />;
}

function usePollTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), NETWORK_FRAME_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
  return tick;
}

const feedStyle: CSSProperties = {
  width: '100%',
  aspectRatio: '4 / 3',
  background: 'var(--lf-bg-2)',
  borderRadius: 4,
  objectFit: 'contain',
};
