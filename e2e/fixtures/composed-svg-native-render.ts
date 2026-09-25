import type { Page } from '@playwright/test';

export interface NativeSvgComparison {
  readonly width: number;
  readonly height: number;
  readonly sourceViewBox: readonly number[];
  readonly exportedViewBox: readonly number[];
  readonly changedPixels: number;
  readonly changedFraction: number;
  readonly paintedPixels: number;
  readonly sourcePng: string;
  readonly exportedPng: string;
}

/** Chromium's native SVG parser/rendering, independent of KerfDesk's SVG implementation. */
export async function compareNativeSvg(
  page: Page,
  sourceSvg: string,
  exportedSvg: string,
): Promise<NativeSvgComparison> {
  return page.evaluate(
    async ({ sourceSvg, exportedSvg }) => {
      const viewBox = (svg: string): number[] => {
        const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
        return (root.getAttribute('viewBox') ?? '').trim().split(/\s+/).map(Number);
      };
      const sourceViewBox = viewBox(sourceSvg);
      const exportedViewBox = viewBox(exportedSvg);
      const width = 1200;
      const height = Math.max(
        1,
        Math.round((width * Number(sourceViewBox[3])) / Number(sourceViewBox[2])),
      );
      const render = async (svg: string) => {
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx === null) throw new Error('Native SVG comparison needs Canvas2D');
          ctx.drawImage(image, 0, 0, width, height);
          return { pixels: ctx.getImageData(0, 0, width, height).data, png: canvas.toDataURL() };
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      const [source, exported] = await Promise.all([render(sourceSvg), render(exportedSvg)]);
      let changedPixels = 0;
      let paintedPixels = 0;
      for (let index = 0; index < source.pixels.length; index += 4) {
        if (Number(source.pixels[index + 3]) > 0) paintedPixels += 1;
        if (
          [0, 1, 2, 3].some(
            (channel) =>
              Math.abs(
                Number(source.pixels[index + channel]) - Number(exported.pixels[index + channel]),
              ) > 12,
          )
        ) {
          changedPixels += 1;
        }
      }
      return {
        width,
        height,
        sourceViewBox,
        exportedViewBox,
        changedPixels,
        paintedPixels,
        changedFraction: changedPixels / (width * height),
        sourcePng: source.png,
        exportedPng: exported.png,
      };
    },
    { sourceSvg, exportedSvg },
  );
}
