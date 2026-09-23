export type PreparedArtworkPage = {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly thumbnail: string;
  readonly vectorSvg: string | null;
  readonly note: string;
  readonly resolutionEditable: boolean;
  readonly render: (dpi: number) => Promise<HTMLCanvasElement>;
};

export type PagedArtworkSource = {
  readonly name: string;
  readonly pageCount: number;
  readonly prepare: (pageNumber: number) => Promise<PreparedArtworkPage>;
  readonly dispose: () => Promise<void>;
};

export function pageCanvas(width: number, height: number): HTMLCanvasElement {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The page dimensions must be positive and finite.');
  }
  if (width > 16384 || height > 16384) {
    throw new Error('This resolution exceeds the browser canvas edge limit. Choose a lower DPI.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  return canvas;
}
