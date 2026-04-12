import { useState, useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { compileJob } from '../../core/job/JobCompiler';
import { optimizePlan } from '../../core/plan/PlanOptimizer';
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
      const sceneForJob = await expandTextOutlinesForCompile(targetScene);
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

  return { currentGcode, setCurrentGcode, compileGcode };
}
