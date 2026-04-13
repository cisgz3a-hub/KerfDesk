import { useState, useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { compileJob } from '../../core/job/JobCompiler';
import { optimizePlan } from '../../core/plan/PlanOptimizer';
import { type Move } from '../../core/plan/Plan';
import { getOutputStrategy } from '../../core/output/Output';
import { type GcodeStartMode } from '../../core/output/GcodeOrigin';
import '../../core/output/GrblStrategy';
import { expandTextOutlinesForCompile } from '../../geometry/expandTextForCompile';

export function useGcodeExport(
  startMode: GcodeStartMode = 'current',
  savedOrigin: { x: number; y: number } | null = null,
) {
  const [currentGcode, setCurrentGcode] = useState<string | null>(null);

  const compileGcode = useCallback(async (targetScene: Scene): Promise<string | null> => {
    try {
      const { scene: sceneForJob, failedTextObjects } = await expandTextOutlinesForCompile(targetScene);
      if (failedTextObjects.length > 0) {
        console.warn(`[LaserForge] Text outline conversion failed for: ${failedTextObjects.join(', ')}. These text objects will be excluded from the job. Try a larger font size or bolder font.`);
      }
      const job = compileJob(sceneForJob);
      if (job.operations.length === 0) return null;
      const plan = optimizePlan(job);
      const strategy = getOutputStrategy('grbl');
      if (!strategy) return null;
      const output = strategy.generate(plan, job, { startMode, savedOrigin });
      return output.text ?? null;
    } catch (err) {
      console.error('G-code compilation failed:', err);
      return null;
    }
  }, [startMode, savedOrigin]);

  const compileToolpathMoves = useCallback(async (targetScene: Scene): Promise<Move[] | null> => {
    try {
      const { scene: sceneForJob, failedTextObjects } = await expandTextOutlinesForCompile(targetScene);
      if (failedTextObjects.length > 0) {
        console.warn(`[LaserForge] Text outline conversion failed for: ${failedTextObjects.join(', ')}`);
      }
      const job = compileJob(sceneForJob);
      if (job.operations.length === 0) return null;
      const plan = optimizePlan(job);
      const moves: Move[] = [];
      for (const op of plan.operations) {
        moves.push(...op.moves);
      }
      return moves;
    } catch (err) {
      console.error('Toolpath compilation failed:', err);
      return null;
    }
  }, []);

  return { currentGcode, setCurrentGcode, compileGcode, compileToolpathMoves };
}
