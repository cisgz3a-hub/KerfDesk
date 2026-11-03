import { isSendableGcodeLine } from '../controllers/grbl';

/** Earliest serial-arrival schedule, overlapping transmission with earlier execution.
 * Controller buffering/ACK latency may add time; this is not a hardware simulator. */
export function programTransportTime(
  gcode: string,
  rawExecutionStartSeconds: Float64Array,
  baudRate: number | undefined,
  hostToolChangePauses = false,
): { readonly rawLineTransportSeconds: Float64Array; readonly wireSeconds: number } {
  const overhead = new Float64Array(rawExecutionStartSeconds.length);
  const clock = createTransportClock(baudRate, hostToolChangePauses);
  if (clock === null) return { rawLineTransportSeconds: overhead, wireSeconds: 0 };
  gcode.split(/\r\n|\n|\r/).forEach((rawLine, index) => {
    overhead[index] = clock.line(rawLine, rawExecutionStartSeconds[index] ?? 0);
  });
  return { rawLineTransportSeconds: overhead, wireSeconds: clock.wireSeconds() };
}

export type TransportClock = {
  /** Feeds the next raw line; returns the transport delay accumulated through it. */
  readonly line: (rawLine: string, executionStartSeconds: number) => number;
  readonly wireSeconds: () => number;
};

/** The schedule above, one raw line at a time. Null when no baud rate applies. */
export function createTransportClock(
  baudRate: number | undefined,
  hostToolChangePauses = false,
): TransportClock | null {
  if (baudRate === undefined || !Number.isFinite(baudRate) || baudRate <= 0) return null;
  let wireSeconds = 0;
  let extraSeconds = 0;
  let sectionWireSeconds = 0;
  let sectionStartSeconds = 0;
  return {
    line: (rawLine, executionStartSeconds) => {
      const line = rawLine.trim();
      if (hostToolChangePauses && isHostPause(line)) {
        // The sender cannot queue the next tool's program until this section
        // physically drains and the operator continues. Exclude operator time,
        // but never hide the next section's delivery under pre-pause motion.
        sectionStartSeconds = executionStartSeconds + extraSeconds;
        sectionWireSeconds = 0;
      } else if (isSendableGcodeLine(line)) {
        // 8N1: one start bit, eight data bits, one stop bit per UTF-8 byte.
        const deliverySeconds = ((utf8Bytes(line) + 1) * 10) / baudRate;
        wireSeconds += deliverySeconds;
        sectionWireSeconds += deliverySeconds;
        extraSeconds = Math.max(
          extraSeconds,
          sectionStartSeconds + sectionWireSeconds - executionStartSeconds,
        );
      }
      return extraSeconds;
    },
    wireSeconds: () => wireSeconds,
  };
}

/**
 * Visits the lines `gcode.split(/\r\n|\n|\r/)` would give, in order, without
 * holding them all: a bed-sized photo's program is 8 million lines.
 */
export function forEachRawLine(gcode: string, visit: (line: string, index: number) => void): void {
  let start = 0;
  let index = 0;
  for (let at = 0; at < gcode.length; at += 1) {
    const code = gcode.charCodeAt(at);
    if (code !== 10 && code !== 13) continue;
    visit(gcode.slice(start, at), index);
    index += 1;
    if (code === 13 && gcode.charCodeAt(at + 1) === 10) at += 1;
    start = at + 1;
  }
  visit(gcode.slice(start), index);
}

function isHostPause(line: string): boolean {
  const code = line
    .replace(/\(.*?\)/g, '')
    .replace(/;.*$/, '')
    .trim();
  return /^M0?[01]$/i.test(code);
}

// Pure core: no dependency on a browser/Node TextEncoder implementation.
function utf8Bytes(text: string): number {
  let count = 0;
  for (const character of text) {
    const value = character.codePointAt(0) ?? 0;
    count += value <= 0x7f ? 1 : value <= 0x7ff ? 2 : value <= 0xffff ? 3 : 4;
  }
  return count;
}
