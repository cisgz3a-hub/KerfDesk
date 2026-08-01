import { describe, expect, it, vi } from 'vitest';
import type { PreflightIssue } from '../../core/preflight';
import type * as GcodeModule from '../../io/gcode';
import { emitPreparedGcode, type PreparedOutput } from '../../io/gcode';
import { injectPreflightIssues } from './cnc-recovery-flow-testing';

vi.mock('../../io/gcode', async (importOriginal) => {
  const actual = await importOriginal<typeof GcodeModule>();
  return { ...actual, emitPreparedGcode: vi.fn(actual.emitPreparedGcode) };
});

const REAL_ISSUE: PreflightIssue = {
  code: 'empty-output',
  message: 'The real emitter found no output.',
};
const INJECTED_ISSUE: PreflightIssue = {
  code: 'out-of-bed',
  message: 'Injected policy advisory.',
};

describe('injectPreflightIssues', () => {
  it('preserves real preflight issues ahead of injected issues', async () => {
    const refusedPrepared: PreparedOutput = {
      ok: false,
      preflight: { ok: false, issues: [REAL_ISSUE] },
    };
    await injectPreflightIssues([INJECTED_ISSUE]);

    const emitted = emitPreparedGcode(refusedPrepared);

    expect(emitted.preflight).toEqual({
      ok: false,
      issues: [REAL_ISSUE, INJECTED_ISSUE],
    });
  });
});
