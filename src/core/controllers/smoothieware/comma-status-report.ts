// Parse the classic comma-delimited Smoothieware status report.
//
// Smoothie's `?` status can arrive in either the GRBL-1.1 pipe grammar
// (`<Idle|MPos:...|WPos:...>`, handled by grbl/status-parser) or the classic
// GRBL-0.9-style grammar `<Idle,MPos:x,y,z,WPos:x,y,z>` where the field
// separators AND the axis-triple separators are both commas. The pipe parser
// splits on `|`, so a comma report collapses into a single field whose state
// token ("Idle,MPos") fails — the DRO never updates and controllerIdle stays
// false (JogPad disabled). We regroup the comma fields back into the pipe
// grammar the shared parser already understands, so no GRBL behavior shifts.
//
// NOT hardware-verified which format current stock Smoothie builds emit; this
// is a tolerant-parser fix that accepts both.

import { parseStatusReport, type StatusReport } from '../grbl/status-parser';

export function parseCommaStatusReport(line: string): StatusReport | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('<') || !trimmed.endsWith('>')) return null;
  const inner = trimmed.slice(1, -1);
  // A pipe report is already handled by parseStatusReport upstream; only act on
  // the comma grammar (no `|`, at least one comma to regroup).
  if (inner.includes('|') || !inner.includes(',')) return null;
  return parseStatusReport(`<${commaFieldsToPipe(inner)}>`);
}

// Regroup comma-separated fields into pipe-separated ones: the first token is
// the state, and each subsequent `Label:...` token starts a new field that
// absorbs the bare numeric tokens (its axis triple) that follow it.
function commaFieldsToPipe(inner: string): string {
  const groups: string[] = [];
  let current = '';
  inner.split(',').forEach((token, index) => {
    if (index === 0 || token.includes(':')) {
      if (current !== '') groups.push(current);
      current = token;
    } else {
      current += `,${token}`;
    }
  });
  if (current !== '') groups.push(current);
  return groups.join('|');
}
