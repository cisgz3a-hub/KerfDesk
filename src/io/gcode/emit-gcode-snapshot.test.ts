import { describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { emitGcode } from './emit-gcode';
import { emitGcodeSnapshot } from './emit-gcode-snapshot';

const NOW = new globalThis.Date('2026-07-12T01:02:03.000Z');

describe('emitGcodeSnapshot', () => {
  it('keeps non-variable output byte-identical to the synchronous emitter', async () => {
    const project = createProject();

    const result = await emitGcodeSnapshot(project, {
      clock: () => NOW,
      renderVariableText: async () => {
        throw new Error('non-variable projects must not render text');
      },
    });

    expect(result).toEqual(emitGcode(project));
  });
});
