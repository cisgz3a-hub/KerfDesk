import { useEffect, useRef, type MouseEvent } from 'react';
import type { PhotoTestSource, PhotoTestWindow } from '../../core/job/photo-test-patch';

const THUMBNAIL_MAX_PX = 260;
const BYTE_MAX = 255;

/**
 * ADR-711: the photo with the piece every square burns outlined on it. A click
 * moves the piece; the two percentage fields beside it do the same by keyboard.
 */
export function PhotoTestPatchPicker(props: {
  readonly source: PhotoTestSource;
  readonly window: PhotoTestWindow;
  /** Centre of the piece in percent across and down the photo. */
  readonly onPick: (centreX: number, centreY: number) => void;
}): JSX.Element {
  const { source, window } = props;
  const canvas = useThumbnail(source);
  const size = thumbnailSize(source);
  const pick = (event: MouseEvent<HTMLButtonElement>): void => {
    // A keyboard press has no position; the percentage fields move the piece.
    if (event.detail === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    props.onPick(
      percent((event.clientX - box.left) / box.width),
      percent((event.clientY - box.top) / box.height),
    );
  };
  return (
    <button
      type="button"
      className="lf-photo-test-card__picker"
      style={{ width: size.width, height: size.height }}
      aria-label="Photo piece to burn"
      title="Click the part of the photo every square should burn, such as the eyes."
      onClick={pick}
    >
      <canvas ref={canvas} width={size.width} height={size.height} aria-hidden="true" />
      <span
        className="lf-photo-test-card__window"
        style={{
          left: `${(window.minX / source.pixelWidth) * 100}%`,
          top: `${(window.minY / source.pixelHeight) * 100}%`,
          width: `${((window.maxX - window.minX) / source.pixelWidth) * 100}%`,
          height: `${((window.maxY - window.minY) / source.pixelHeight) * 100}%`,
        }}
      />
    </button>
  );
}

function percent(fraction: number): number {
  return Math.round(Math.max(0, Math.min(1, fraction)) * 100);
}

function thumbnailSize(source: PhotoTestSource): {
  readonly width: number;
  readonly height: number;
} {
  const scale = THUMBNAIL_MAX_PX / Math.max(source.pixelWidth, source.pixelHeight, 1);
  return {
    width: Math.max(1, Math.round(source.pixelWidth * Math.min(1, scale))),
    height: Math.max(1, Math.round(source.pixelHeight * Math.min(1, scale))),
  };
}

function useThumbnail(source: PhotoTestSource): React.RefObject<HTMLCanvasElement> {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext('2d') ?? null;
    if (context === null) return;
    const { width, height } = thumbnailSize(source);
    context.putImageData(new ImageData(thumbnailRgba(source, width, height), width, height), 0, 0);
  }, [source]);
  return canvas;
}

/** The stored pixels sampled down to the thumbnail, as opaque greys. */
export function thumbnailRgba(
  source: PhotoTestSource,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(source.pixelHeight - 1, Math.floor((y / height) * source.pixelHeight));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(source.pixelWidth - 1, Math.floor((x / width) * source.pixelWidth));
      const grey = source.luma[sourceY * source.pixelWidth + sourceX] ?? BYTE_MAX;
      rgba.set([grey, grey, grey, BYTE_MAX], (y * width + x) * 4);
    }
  }
  return rgba;
}
