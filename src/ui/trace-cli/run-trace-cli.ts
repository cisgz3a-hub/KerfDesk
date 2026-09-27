// The headless trace command (ADR-477): one image in, one vector file out,
// through the pipeline Multi-File Trace runs in the app (traceImagesToVectorFiles
// with the same DXF and PDF/EPS/GeoJSON writers), with the Trace dialog's
// preset and override merge. Node I/O stays in scripts/trace-cli.ts, so this
// module is testable in-process and the bytes it writes are the app's.

import { TRACE_PRESETS, traceImagesToVectorFiles, type TraceOptions } from '../../core/trace';
import { tracedLayersToDxf } from '../../io/dxf/export-dxf';
import { writeTracedDrawing } from '../../io/vector-formats/traced-drawing';
import { withHybridMaxStrokeWidth } from '../trace/hybrid-stroke-width';
import { mergeLightBurnTraceSettings } from '../trace/trace-options';
import { traceCliHelp } from './trace-cli-help';
import { parseTraceCliArgs, TraceCliUsageError, type TraceCliOptions } from './trace-cli-options';
import { traceCliSource, type TraceCliSource } from './trace-cli-source';

export type TraceCliIo = {
  /** The input file's bytes; `null` reads standard input. */
  readonly readInput: (path: string | null) => Promise<Uint8Array>;
  /** Writes the output text; `null` writes standard output. */
  readonly writeOutput: (path: string | null, text: string) => Promise<void>;
  readonly writeError: (text: string) => void;
};

export const TRACE_CLI_EXIT = { ok: 0, failed: 1, usage: 2, empty: 3 } as const;

export async function runTraceCli(argv: ReadonlyArray<string>, io: TraceCliIo): Promise<number> {
  let options: TraceCliOptions;
  try {
    options = parseTraceCliArgs(argv);
  } catch (error) {
    io.writeError(`kerfdesk-trace: ${message(error)}\n`);
    return TRACE_CLI_EXIT.usage;
  }
  if (options.help) {
    await io.writeOutput(null, traceCliHelp());
    return TRACE_CLI_EXIT.ok;
  }
  try {
    const text = await traceCliText(await io.readInput(options.input), options);
    if (text === null) {
      io.writeError('kerfdesk-trace: the trace found nothing to draw; no file written.\n');
      return TRACE_CLI_EXIT.empty;
    }
    await io.writeOutput(options.output, text);
    return TRACE_CLI_EXIT.ok;
  } catch (error) {
    io.writeError(`kerfdesk-trace: ${message(error)}\n`);
    return error instanceof TraceCliUsageError ? TRACE_CLI_EXIT.usage : TRACE_CLI_EXIT.failed;
  }
}

/** The vector file text for one encoded image, or null when nothing traced. */
export async function traceCliText(
  bytes: Uint8Array,
  options: TraceCliOptions,
): Promise<string | null> {
  if (bytes.length === 0) throw new Error('The input is empty.');
  const source = await traceCliSource(bytes, options.dpi);
  const result = await traceImagesToVectorFiles(
    [
      {
        sourceName: options.input ?? 'stdin',
        image: source.image,
        physicalSizeMm: { widthMm: source.widthMm, heightMm: source.heightMm },
        options: traceCliTraceOptions(options, source),
      },
    ],
    { writeDxf: tracedLayersToDxf, writeDrawing: writeTracedDrawing },
    {
      format: options.format,
      precisionMm: options.precisionMm,
      groupContours: options.groupContours,
      // As the Multi-File Trace dialog: the image page is the writers' default.
      ...(options.pageFit === 'artwork'
        ? { page: { fit: 'artwork', marginMm: options.marginMm } }
        : {}),
    },
  );
  return result.files[0]?.text ?? null;
}

/** Preset plus overrides, merged as the Trace dialog merges them. */
export function traceCliTraceOptions(
  options: Pick<TraceCliOptions, 'presetName' | 'overrides'>,
  source: Pick<TraceCliSource, 'image' | 'widthMm'>,
): TraceOptions {
  const preset = TRACE_PRESETS[options.presetName];
  if (preset === undefined) throw new TraceCliUsageError(`Unknown preset ${options.presetName}.`);
  const merged = mergeLightBurnTraceSettings(preset, options.overrides);
  const widthMm = options.overrides.hybridMaxStrokeWidthMm;
  // Line + fill's Max stroke width is in placed millimetres (ADR-454); the
  // image traces on its stored grid, so that grid's density converts it.
  if (widthMm === undefined) return merged;
  return withHybridMaxStrokeWidth(merged, widthMm, source.image.width / source.widthMm);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
