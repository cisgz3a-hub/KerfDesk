// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS, traceImagesToVectorFiles, type RawImageData } from '../../core/trace';
import type { BatchTraceFormat, BatchTraceOutput } from '../../core/trace/batch-trace';
import { TRACED_PAPER_SIZES_MM } from '../../core/trace/traced-page-box';
import { DEFAULT_EXPORT_PRECISION_MM } from '../../core/vector-export/decimal-grid';
import { tracedLayersToDxf } from '../../io/dxf/export-dxf';
import { writeTracedDrawing } from '../../io/vector-formats/traced-drawing';

// Paper pages through the real writers (rank 33): an A4 page with asymmetric
// per-side margins is A4 in every format, and the artwork sits centred in the
// area inside the margins, moved by whole export-grid steps from where the
// fitted page puts it.

function ringImage(): RawImageData {
  const width = 64;
  const height = 48;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = Math.hypot(x - 24, y - 24);
      const ink = (r > 9 && r < 17) || (x > 44 && x < 58 && y > 8 && y < 40);
      if (ink) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
  }
  return { width, height, data };
}

const LINE_ART = TRACE_PRESETS['Line Art'];
const MARGINS = { top: 10, right: 5, bottom: 20, left: 30 };
const A4 = TRACED_PAPER_SIZES_MM.a4;

async function exported(format: BatchTraceFormat, page: BatchTraceOutput['page']): Promise<string> {
  const result = await traceImagesToVectorFiles(
    [
      {
        sourceName: 'ring.png',
        image: ringImage(),
        physicalSizeMm: { widthMm: 6.4, heightMm: 4.8 },
        ...(LINE_ART === undefined ? {} : { options: LINE_ART }),
      },
    ],
    { writeDrawing: writeTracedDrawing, writeDxf: tracedLayersToDxf },
    { format, ...(page === undefined ? {} : { page }) },
  );
  const text = result.files[0]?.text;
  if (text === undefined) throw new Error(`No ${format} file.`);
  return text;
}

function svgPage(svg: string): { readonly width: string; readonly height: string } {
  const attr = (name: string) => new RegExp(`<svg[^>]*\\s${name}="([^"]*)"`).exec(svg)?.[1] ?? '';
  return { width: attr('width'), height: attr('height') };
}

/** Vertex extents of every entity, in the DXF's Y-up millimetres. */
function dxfExtents(dxf: string) {
  // Entities only: the header's $EXTMIN, $EXTMAX and $INSBASE also use 10/20.
  const all = dxf.split(/\r?\n/).map((line) => line.trim());
  const lines = all.slice(all.indexOf('ENTITIES') + 1);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (lines[i] === '10') xs.push(Number(lines[i + 1]));
    if (lines[i] === '20') ys.push(Number(lines[i + 1]));
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

describe('Multi-File Trace paper page goldens (rank 33)', () => {
  const paper = { fit: 'paper', paperMm: A4, margins: MARGINS } as const;

  it('writes an A4 page in SVG and PDF', async () => {
    expect(svgPage(await exported('svg', paper))).toEqual({ width: '210mm', height: '297mm' });
    const pdf = await exported('pdf', paper);
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf);
    // 210 x 297 mm in points.
    expect(Number(box?.[1])).toBeCloseTo((210 / 25.4) * 72, 1);
    expect(Number(box?.[2])).toBeCloseTo((297 / 25.4) * 72, 1);
  });

  it('centres the artwork inside the asymmetric margins in DXF', async () => {
    const fittedSvg = svgPage(await exported('svg', { fit: 'artwork', marginMm: 0 }));
    const fitted = { width: parseFloat(fittedSvg.width), height: parseFloat(fittedSvg.height) };
    const onFitted = dxfExtents(await exported('dxf', { fit: 'artwork', marginMm: 0 }));
    const onPaper = dxfExtents(await exported('dxf', paper));

    const innerWidth = A4.width - MARGINS.left - MARGINS.right;
    const innerHeight = A4.height - MARGINS.top - MARGINS.bottom;
    const expectedDx = MARGINS.left + (innerWidth - fitted.width) / 2;
    const expectedDy = MARGINS.top + (innerHeight - fitted.height) / 2;
    const dx = onPaper.minX - onFitted.minX;
    expect(onPaper.maxX - onFitted.maxX).toBeCloseTo(dx, 9);
    // The DXF is Y-up with the page height as the flip line.
    const dy = A4.height - onPaper.maxY - (fitted.height - onFitted.maxY);
    // Whole grid steps: within one step of exact centring.
    expect(Math.abs(dx - expectedDx)).toBeLessThanOrEqual(DEFAULT_EXPORT_PRECISION_MM + 1e-9);
    expect(Math.abs(dy - expectedDy)).toBeLessThanOrEqual(DEFAULT_EXPORT_PRECISION_MM + 1e-9);
  });

  it('keeps a Letter page in SVG with a shared margin', async () => {
    const letter = { fit: 'paper', paperMm: TRACED_PAPER_SIZES_MM.letter, marginMm: 12 } as const;
    expect(svgPage(await exported('svg', letter))).toEqual({
      width: '215.9mm',
      height: '279.4mm',
    });
  });
});
