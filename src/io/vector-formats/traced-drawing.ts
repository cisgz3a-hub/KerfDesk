// Multi-File Trace output as PDF, EPS or GeoJSON (ADR-444). The page is the
// traced page: the source image by default, so every file of a batch shares
// the image's frame, or the artwork plus a margin (ADR-451). Its lower-left
// corner is the origin, as in the DXF output.

import type { BatchTraceDrawingFormat } from '../../core/trace/batch-trace';
import type { TracedLayer, TracedVectorOptions } from '../../core/trace/batch-trace-svg';
import { writeEpsDocument } from './eps-writer';
import { writeGeoJsonDocument } from './geojson-writer';
import { writePdfDocument } from './pdf-writer';
import { tracedLayerItems, type VectorWriteOptions } from './vector-artwork';

export function writeTracedDrawing(
  format: BatchTraceDrawingFormat,
  layers: ReadonlyArray<TracedLayer>,
  options: TracedVectorOptions & {
    readonly pageWidth: number;
    readonly pageHeight: number;
    readonly strokeOnly: boolean;
  },
): string {
  const items = tracedLayerItems(layers, options.strokeOnly);
  const write: VectorWriteOptions = {
    ...(options.precisionMm === undefined ? {} : { precisionMm: options.precisionMm }),
    page: { minX: 0, minY: 0, maxX: options.pageWidth, maxY: options.pageHeight },
  };
  if (format === 'pdf') return writePdfDocument(items, write).text;
  if (format === 'eps') return writeEpsDocument(items, write).text;
  return writeGeoJsonDocument(items, write).text;
}
