import { describe, expect, it } from 'vitest';
import { executionArtifactIntegrityIsValid } from './execution-artifact-integrity';
import { MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES } from './execution-artifact-size';
import { createCurrentTestExecutionArtifact } from './testing/execution-artifact-test-fixture';

// A photo engraving over the archive budget still streams. The copy its page
// keeps for the second-pass offer is never archived, so the budget does not
// refuse it (ADR-341 Amendment 7).
describe('an execution artifact kept only in the page', () => {
  const LINE = 'G1 X1 S1\n';
  const oversized = LINE.repeat(
    Math.ceil((MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES + 1) / LINE.length),
  );

  it('is built for a program the archive refuses, and passes its integrity check', async () => {
    await expect(
      createCurrentTestExecutionArtifact({ runId: 'too-large', gcode: oversized }),
    ).rejects.toThrow('exceeds the safe archive size');

    const kept = await createCurrentTestExecutionArtifact({
      runId: 'too-large',
      gcode: oversized,
      enforceArchiveBudget: false,
    });

    expect(kept.gcode).toBe(oversized);
    expect(kept.estimatedArtifactBytes).toBeUndefined();
    await expect(executionArtifactIntegrityIsValid(kept)).resolves.toBe(true);
  }, 60_000);
});
