import { expect, it } from 'vitest';
import { createProject, DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import { canvasPlanRetentionKey } from './canvas-motion-plan';

it('binds overlap removal to the exact prepared-job and completed-Frame identity', () => {
  const project = createProject();
  const changed = {
    ...project,
    optimization: { ...project.optimization, removeOverlappingLines: true },
  };
  const placement = { startFrom: 'absolute' as const, anchor: 'front-left' as const };
  // This key is also currentReplayExecutionSignature, which the existing Frame
  // permit readiness path compares. No new policy gate is needed.
  expect(canvasPlanRetentionKey(changed, DEFAULT_OUTPUT_SCOPE, placement)).not.toBe(
    canvasPlanRetentionKey(project, DEFAULT_OUTPUT_SCOPE, placement),
  );
});
