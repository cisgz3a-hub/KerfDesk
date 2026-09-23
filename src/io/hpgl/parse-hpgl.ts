// Clean-room geometry subset of HP's PCL 5 / HP-GL/2 reference, chapters 17, 19–22:
// https://www.hp.com/ctg/Manual/bpl13211.pdf
// Plotter units are 0.025 mm. No device page defaults, clipping or ignored drawing commands.
import { hpglCommands } from './hpgl-tokenizer';
import { createHpglState, executeHpgl } from './hpgl-interpreter';
import { flushStroke } from './hpgl-paths';
import { hpglResult } from './hpgl-result';
import { HpglError, type ParseHpglResult } from './hpgl-types';

export function parseHpgl(args: {
  readonly text: string;
  readonly id: string;
  readonly source: string;
}): ParseHpglResult {
  const state = createHpglState();
  try {
    for (const command of hpglCommands(args.text)) executeHpgl(state, command);
    if (state.polygonMode)
      throw new HpglError(
        'unterminated-polygon',
        'Polygon mode was not closed with PM2.',
        state.command,
      );
    flushStroke(state);
    return hpglResult(state, args);
  } catch (error) {
    const failure =
      error instanceof HpglError
        ? error
        : new HpglError(
            'invalid-geometry',
            error instanceof Error ? error.message : 'Could not parse HPGL.',
          );
    return { kind: 'error', reason: failure.message, diagnostics: [failure.diagnostic] };
  }
}
