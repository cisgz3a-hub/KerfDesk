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
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  // Canvas dimensions use unsigned integers. Check the browser's actual
  // representation and context instead of imposing a guessed edge limit.
  if (canvas.width !== Math.ceil(width) || canvas.height !== Math.ceil(height)) {
    throw new Error('The browser cannot represent a canvas at this page size.');
  }
  if (canvas.getContext('2d') === null) {
    throw new Error('The browser could not create a canvas at this page size.');
  }
  return canvas;
}
