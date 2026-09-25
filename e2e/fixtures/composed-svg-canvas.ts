import type { Project, RasterImage } from '../../src/core/scene';
import { expect, type Page } from './kerfdesk-test';

interface CanvasCapture {
  readonly png: string;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** Read the painted workspace and its viewport, without invoking its SVG or draw helpers. */
export async function captureSvgCanvas(page: Page, project: Project): Promise<CanvasCapture> {
  return page.evaluate(async ({ bedWidth, bedHeight }) => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[aria-label="KerfDesk workspace"]',
    );
    if (canvas === null) throw new Error('Workspace canvas missing');
    const path = '/src/ui/state/ui-store.ts';
    const { useUiStore } = (await import(/* @vite-ignore */ path)) as {
      useUiStore: { getState: () => { zoomFactor: number; panX: number; panY: number } };
    };
    const { zoomFactor, panX, panY } = useUiStore.getState();
    const scale =
      Math.min((canvas.width - 60) / bedWidth, (canvas.height - 60) / bedHeight) * zoomFactor;
    return {
      png: canvas.toDataURL(),
      width: canvas.width,
      height: canvas.height,
      scale,
      offsetX: (canvas.width - bedWidth * scale) / 2 + panX * scale,
      offsetY: (canvas.height - bedHeight * scale) / 2 + panY * scale,
    };
  }, project.device);
}

/** Independent source-matrix checks plus native-SVG pixels against the actual workspace. */
export async function compareClippedCanvas(
  page: Page,
  sourceSvg: string,
  raster: RasterImage,
  painted: CanvasCapture,
  empty: CanvasCapture,
) {
  const t = raster.transform;
  const rad = (t.rotationDeg * Math.PI) / 180;
  const sx = t.scaleX * (t.mirrorX ? -1 : 1);
  const sy = t.scaleY * (t.mirrorY ? -1 : 1);
  const matrix = [Math.cos(rad) * sx, Math.sin(rad) * sx, -Math.sin(rad) * sy, Math.cos(rad) * sy];
  const original = [
    -1.7143346014042247, -1.0300761498201083, 0.3862785561825406, -0.6428754755265842,
  ];
  matrix.forEach((value, i) => expect(value).toBeCloseTo(Number(original[i]), 10));
  expect(raster.bounds).toEqual({ minX: -2, minY: 4, maxX: 38, maxY: 34 });
  expect({ ...painted, png: undefined }).toEqual({ ...empty, png: undefined });
  return page.evaluate(
    async ({ sourceSvg, t, matrix, painted, empty }) => {
      const decode = async (src: string) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        return img;
      };
      const actual = document.createElement('canvas');
      actual.width = painted.width;
      actual.height = painted.height;
      const expected = actual.cloneNode() as HTMLCanvasElement;
      const ctx = actual.getContext('2d');
      const ref = expected.getContext('2d');
      if (ctx === null || ref === null) throw new Error('Canvas2D unavailable');
      ctx.drawImage(await decode(painted.png), 0, 0);
      ref.drawImage(await decode(empty.png), 0, 0);
      const root = new DOMParser().parseFromString(sourceSvg, 'image/svg+xml').documentElement;
      const [x, y, w, h] = (root.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
      const url = URL.createObjectURL(new Blob([sourceSvg], { type: 'image/svg+xml' }));
      try {
        ref.drawImage(
          await decode(url),
          painted.offsetX + (Number(x) + t.x + 80) * painted.scale,
          painted.offsetY + (Number(y) + t.y - 35) * painted.scale,
          Number(w) * painted.scale,
          Number(h) * painted.scale,
        );
      } finally {
        URL.revokeObjectURL(url);
      }
      const points = [
        { name: 'upper visible image', x: 0, y: 6 },
        { name: 'lower visible image', x: 20, y: 26 },
        { name: 'right visible image', x: 22, y: 8 },
        { name: 'clip hole', x: 10, y: 16 },
        { name: 'outside owned clip', x: 33, y: 18 },
        { name: 'outside ancestor clip', x: 0, y: 30 },
      ];
      return points.map((point) => {
        const x = Math.floor(
          painted.offsetX +
            (Number(matrix[0]) * point.x + Number(matrix[2]) * point.y + t.x) * painted.scale,
        );
        const y = Math.floor(
          painted.offsetY +
            (Number(matrix[1]) * point.x + Number(matrix[3]) * point.y + t.y) * painted.scale,
        );
        const observed = [...ctx.getImageData(x, y, 1, 1).data];
        const reference = [...ref.getImageData(x, y, 1, 1).data];
        return {
          name: point.name,
          x,
          y,
          observed,
          reference,
          maxDifference: Math.max(
            ...observed.map((channel, index) => Math.abs(channel - Number(reference[index]))),
          ),
        };
      });
    },
    { sourceSvg, t, matrix, painted, empty },
  );
}
