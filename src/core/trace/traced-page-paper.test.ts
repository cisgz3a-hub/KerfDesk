import { describe, expect, it } from 'vitest';
import type { ColoredPath } from '../scene';
import { traceImagesToVectorFiles } from './batch-trace';
import type { RawImageData } from './trace-image';
import { TRACED_PAPER_SIZES_MM } from './traced-page-box';

// A 10 x 10 px square at (10, 20) on a 100 x 100 px image placed at 100 mm.
const SQUARE: ColoredPath = {
  color: '#000000',
  polylines: [
    {
      closed: true,
      points: [
        { x: 10, y: 20 },
        { x: 20, y: 20 },
        { x: 20, y: 30 },
        { x: 10, y: 30 },
      ],
    },
  ],
};

function rawImage(width: number, height: number): RawImageData {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

async function svgFor(page: Parameters<typeof traceImagesToVectorFiles>[2]): Promise<string> {
  const { files } = await traceImagesToVectorFiles(
    [
      {
        sourceName: 'a.png',
        image: rawImage(100, 100),
        physicalSizeMm: { widthMm: 100, heightMm: 100 },
      },
    ],
    { trace: async () => [SQUARE] },
    page,
  );
  return files[0]?.text ?? '';
}

describe('paper pages and per-side margins (rank 33)', () => {
  it('puts the artwork at the centre of an A4 page', async () => {
    const svg = await svgFor({ page: { fit: 'paper', paperMm: TRACED_PAPER_SIZES_MM.a4 } });
    expect(svg).toContain('width="210mm"');
    expect(svg).toContain('height="297mm"');
    expect(svg).toContain('viewBox="0 0 210 297"');
    // Square centre (15, 25) moves to (105, 148.5): offset (90, 123.5).
    expect(svg).toMatch(/M\s*100[ ,]143\.5/);
  });

  it('centres inside asymmetric margins on a Letter page', async () => {
    const svg = await svgFor({
      page: {
        fit: 'paper',
        paperMm: TRACED_PAPER_SIZES_MM.letter,
        margins: { top: 10, right: 0, bottom: 30, left: 20 },
      },
    });
    expect(svg).toContain('viewBox="0 0 215.9 279.4"');
    // Area centre: x = 20 + 195.9 / 2 = 117.95, y = 10 + 239.4 / 2 = 129.7.
    expect(svg).toMatch(/M\s*112\.95[ ,]124\.7/);
  });

  it('grows a fitted page by each side margin', async () => {
    const svg = await svgFor({
      page: { fit: 'artwork', margins: { top: 1, right: 2, bottom: 3, left: 4 } },
    });
    // Artwork 10 x 10 mm plus 4 + 2 across and 1 + 3 down.
    expect(svg).toContain('viewBox="0 0 16 14"');
    expect(svg).toMatch(/M\s*4[ ,]1(?![\d.])/);
  });

  it('keeps oversize artwork centred on the page instead of shrinking the page', async () => {
    const svg = await svgFor({
      page: { fit: 'paper', paperMm: { width: 6, height: 8 }, marginMm: 1 },
    });
    expect(svg).toContain('viewBox="0 0 6 8"');
    // The 10 mm square's centre (15, 25) moves to (3, 4): it starts at (-2, -1).
    expect(svg).toContain('d="M-2-1h10v10h-10z"');
  });

  it('flags artwork that runs past the paper edge, and only that artwork', async () => {
    const flag = async (paperMm: { width: number; height: number }) => {
      const { files } = await traceImagesToVectorFiles(
        [
          {
            sourceName: 'a.png',
            image: rawImage(100, 100),
            physicalSizeMm: { widthMm: 100, heightMm: 100 },
          },
        ],
        { trace: async () => [SQUARE] },
        { page: { fit: 'paper', paperMm } },
      );
      return files[0]?.runsPastPage;
    };
    expect(await flag({ width: 6, height: 8 })).toBe(true);
    // Exactly the artwork's 10 mm square still fits.
    expect(await flag({ width: 10, height: 10 })).toBeUndefined();
    expect(await flag(TRACED_PAPER_SIZES_MM.a4)).toBeUndefined();
  });

  it.each([
    ['a zero side', { width: 0, height: 297 }],
    ['a side over the limit', { width: 210, height: 10001 }],
    ['a non-finite side', { width: Number.NaN, height: 297 }],
  ])('keeps the image page for %s', async (_name, paperMm) => {
    const svg = await svgFor({ page: { fit: 'paper', paperMm } });
    expect(svg).toBe(await svgFor({}));
  });

  it('keeps the image page byte-identical when no page option is set', async () => {
    expect(await svgFor({ page: { fit: 'image' } })).toBe(await svgFor({}));
  });
});
