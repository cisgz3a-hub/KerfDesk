import { buildSurfacingProgram } from '../../core/cnc/surfacing';
import { runStandaloneCncPreflight } from '../../core/preflight/standalone-cnc-preflight';
import { gcodeMetadataHeader } from '../../io/gcode/gcode-metadata';
import type { PreparedSurfacing, SurfacingWorkerInput } from './surfacing-worker-protocol';

// This is a buffering size, not an input/output limit. Each pull is acknowledged
// by the writer before another is requested, so output size never grows the queue.
const LINES_PER_CHUNK = 256;

export function prepareSurfacingStream(input: SurfacingWorkerInput): {
  readonly prepared: PreparedSurfacing;
  readonly chunks: Iterator<string>;
} {
  const result = buildSurfacingProgram(input.params);
  if (!result.ok) throw new Error(result.reason);
  const { lines, ...summary } = result.program;
  const preflight = runStandaloneCncPreflight(input.device, input.machine, lines);
  const header = gcodeMetadataHeader(
    input.metadata,
    {
      kind: 'cnc',
      spindleMaxRpm: input.machine.params.spindleMaxRpm,
    },
    input.device,
  );
  return { prepared: { summary, preflight }, chunks: outputChunks(header, lines) };
}

function* outputChunks(header: string, lines: Iterable<string>): Generator<string> {
  if (header.length > 0) yield header;
  let chunk: string[] = [];
  for (const line of lines) {
    chunk.push(line);
    if (chunk.length === LINES_PER_CHUNK) {
      yield chunk.join('\n') + '\n';
      chunk = [];
    }
  }
  if (chunk.length > 0) yield chunk.join('\n') + '\n';
}
