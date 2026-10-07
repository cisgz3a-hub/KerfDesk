import type { StreamerState } from '../../core/controllers/grbl';
import { scanGcodeWords, stripInlineComments } from '../../core/gcode';
import type { LaserState } from './laser-store';

type AirPatch = Partial<Pick<LaserState, 'airAssistOn'>>;

/** All lines and the driver marker have settled: reconcile the last coolant
 * command even on firmware without accessory reports. M7/M8 enable an output;
 * M9 disables both, independently of the next document's device profile. Jobs
 * without a coolant command leave a separately enabled manual output alone.
 * This records controller commands, never measured physical airflow. */
export function settledProgramAirAssistPatch(streamer: StreamerState | null): AirPatch {
  if (streamer?.status !== 'done') return {};
  for (let lineIndex = streamer.queued.length - 1; lineIndex >= 0; lineIndex -= 1) {
    const enabled = lastAirCommandInLine(streamer.queued[lineIndex]);
    if (enabled !== null) return { airAssistOn: enabled };
  }
  return {};
}

function lastAirCommandInLine(line: string | undefined): boolean | null {
  if (line === undefined || !/[mM]/.test(line)) return null;
  const words = scanGcodeWords(stripInlineComments(line));
  for (let wordIndex = words.length - 1; wordIndex >= 0; wordIndex -= 1) {
    const word = words[wordIndex];
    if (word?.letter !== 'M') continue;
    if (word.value === 9) return false;
    if (word.value === 7 || word.value === 8) return true;
  }
  return null;
}
