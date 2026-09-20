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
  if (baudRate === undefined || !Number.isFinite(baudRate) || baudRate <= 0) {
    return { rawLineTransportSeconds: overhead, wireSeconds: 0 };
  }
  let wireSeconds = 0;
  let extraSeconds = 0;
  let sectionWireSeconds = 0;
  let sectionStartSeconds = 0;
  gcode.split(/\r\n|\n|\r/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (hostToolChangePauses && isHostPause(line)) {
      // The sender cannot queue the next tool's program until this section
      // physically drains and the operator continues. Exclude operator time,
      // but never hide the next section's delivery under pre-pause motion.
      sectionStartSeconds = (rawExecutionStartSeconds[index] ?? 0) + extraSeconds;
      sectionWireSeconds = 0;
    } else if (isSendableGcodeLine(line)) {
      // 8N1: one start bit, eight data bits, one stop bit per UTF-8 byte.
      const deliverySeconds = ((utf8Bytes(line) + 1) * 10) / baudRate;
      wireSeconds += deliverySeconds;
      sectionWireSeconds += deliverySeconds;
      extraSeconds = Math.max(
        extraSeconds,
        sectionStartSeconds + sectionWireSeconds - (rawExecutionStartSeconds[index] ?? 0),
      );
    }
    overhead[index] = extraSeconds;
  });
  return { rawLineTransportSeconds: overhead, wireSeconds };
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
