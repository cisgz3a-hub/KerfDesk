// Tool-change labels (R5): the CNC strategy names the next bit only in a G-code
// comment before each mid-job M0, and the streamer strips comments — so the
// pause UI showed a generic "load the next bit" with no bit identity. The emitter
// and this parser share one prefix constant so they can never drift; the sender
// extracts the labels in stream order and names the bit at each hold.

export const TOOL_CHANGE_LOAD_PREFIX = '; tool change: load ';

// The next-bit labels, in emit (stream) order — one per M0 tool-change pause.
// A program with none (a single-tool job, an imported .nc, or a resume tail)
// yields an empty list, so the UI falls back to the generic prompt.
export function extractToolChangeLabels(gcode: string): ReadonlyArray<string> {
  const labels: string[] = [];
  for (const line of gcode.split('\n')) {
    if (line.startsWith(TOOL_CHANGE_LOAD_PREFIX)) {
      labels.push(line.slice(TOOL_CHANGE_LOAD_PREFIX.length).trim());
    }
  }
  return labels;
}
