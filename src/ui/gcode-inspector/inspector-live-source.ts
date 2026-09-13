import type { GcodeInspectionSource } from './gcode-inspection-source';

/** Incremental comparison keeps file-backed inspection from cloning a large Blob. */
export async function inspectorSourceMatchesProgram(
  source: GcodeInspectionSource,
  text: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (source.kind === 'text') return source.text === text;
  const decoder = new TextDecoder();
  let offset = 0;
  const chunkBytes = 64 * 1024;
  for (let start = 0; start < source.blob.size; start += chunkBytes) {
    if (signal.aborted) return false;
    const bytes = await source.blob.slice(start, start + chunkBytes).arrayBuffer();
    const chunk = decoder.decode(bytes, { stream: true });
    if (text.slice(offset, offset + chunk.length) !== chunk) return false;
    offset += chunk.length;
  }
  const tail = decoder.decode();
  return !signal.aborted && text.slice(offset) === tail;
}
