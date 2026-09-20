import { describe, expect, it } from 'vitest';
import { createProject, DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import { canvasPlanRetentionKey } from './canvas-motion-plan';

// The retention key doubles as the Frame permit's execution signature
// (currentReplayExecutionSignature), so a bare canvas click must not change it
// while "Selected artwork only" is off (ADR-324).
describe('canvasPlanRetentionKey output scope (ADR-324)', () => {
  const placement = { startFrom: 'user-origin' as const, anchor: 'front-left' as const };

  it('ignores the canvas selection while "Selected artwork only" is off', () => {
    const project = createProject();
    const none = canvasPlanRetentionKey(project, DEFAULT_OUTPUT_SCOPE, placement);
    const clicked = canvasPlanRetentionKey(
      project,
      { ...DEFAULT_OUTPUT_SCOPE, selectedObjectIds: ['O1'] },
      placement,
    );
    expect(clicked).toBe(none);
  });

  it('still keys on the selection while "Selected artwork only" is on', () => {
    const project = createProject();
    const first = canvasPlanRetentionKey(
      project,
      { ...DEFAULT_OUTPUT_SCOPE, cutSelectedGraphics: true, selectedObjectIds: ['O1'] },
      placement,
    );
    const second = canvasPlanRetentionKey(
      project,
      { ...DEFAULT_OUTPUT_SCOPE, cutSelectedGraphics: true, selectedObjectIds: ['O2'] },
      placement,
    );
    expect(second).not.toBe(first);
  });
});
