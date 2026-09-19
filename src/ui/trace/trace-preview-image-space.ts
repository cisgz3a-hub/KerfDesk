import { useLayoutEffect, useRef, useState } from 'react';

type ImageSize = { readonly width: number; readonly height: number };
export type TracePreviewImageRect = ImageSize & {
  readonly left: number;
  readonly top: number;
};

// Rounded thumbnails and working grids cover the original image's whole X/Y
// domains. Fit that domain once, then stretch each grid into the same rectangle.
export function fitTracePreviewImage(
  image: ImageSize | undefined,
  width: number,
  height: number,
): TracePreviewImageRect | null {
  if (image === undefined || !positive(image.width) || !positive(image.height)) return null;
  if (!positive(width) || !positive(height)) return null;
  const scale = Math.min(width / image.width, height / image.height);
  if (!positive(scale)) return null;
  const drawnWidth = image.width * scale;
  const drawnHeight = image.height * scale;
  return {
    left: (width - drawnWidth) / 2,
    top: (height - drawnHeight) / 2,
    width: drawnWidth,
    height: drawnHeight,
  };
}

export function useTracePreviewImageSpace(
  image: ImageSize | undefined,
  zoom: number,
): {
  readonly stageRef: React.RefObject<HTMLDivElement>;
  readonly rectangle: TracePreviewImageRect | null;
} {
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ImageSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return undefined;
    let active = true;
    const resize = (next: ImageSize): void => {
      if (active) setMeasuredSize(setSize, next);
    };
    if (typeof ResizeObserver === 'undefined') {
      const onResize = (): void => resize(stage.getBoundingClientRect());
      window.addEventListener('resize', onResize);
      return () => {
        active = false;
        window.removeEventListener('resize', onResize);
      };
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) resize(entry.contentRect);
    });
    observer.observe(stage);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (stage !== null) setMeasuredSize(setSize, stage.getBoundingClientRect());
  }, [zoom]);

  return { stageRef, rectangle: fitTracePreviewImage(image, size.width, size.height) };
}

function setMeasuredSize(
  setSize: React.Dispatch<React.SetStateAction<ImageSize>>,
  next: ImageSize,
): void {
  setSize((previous) =>
    previous.width === next.width && previous.height === next.height
      ? previous
      : { width: next.width, height: next.height },
  );
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
