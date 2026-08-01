import { iterateLines } from '../../core/util';
import {
  createGcodeProgramLineParser,
  GCODE_PREVIEW_CUT_COLOR,
  type GcodeProgramSummary,
  type ParseGcodeProgramResult,
} from './gcode-program-line-parser';

export { GCODE_PREVIEW_CUT_COLOR };
export type { GcodeProgramSummary, ParseGcodeProgramResult };

export function parseGcodeProgram(text: string): ParseGcodeProgramResult {
  const parser = createGcodeProgramLineParser();
  for (const line of iterateLines(text)) parser.pushLine(line);
  return parser.finish();
}
