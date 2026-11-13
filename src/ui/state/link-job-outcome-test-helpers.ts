// Test support for link stores (ADR-705 Amendment 7): a job outcome for a job
// a test builds by hand from encoder output, with no project to prepare. The
// app builds every outcome with linkJobOutcome from a prepared project.

import type { LinkJobOutcome } from './link-job-outcome';

export function testLinkJobOutcome(
  advisories: ReadonlyArray<string> = [],
  completed: () => void = () => undefined,
): LinkJobOutcome {
  return { advisories, completed } as unknown as LinkJobOutcome;
}
