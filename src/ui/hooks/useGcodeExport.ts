import { useState, useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { compileJob } from '../../core/job/JobCompiler';
import { optimizePlan } from '../../core/plan/PlanOptimizer';
import { getOutputStrategy } from '../../core/output/Output';
import '../../core/output/GrblStrategy';

export function useGcodeExport() {
  const [currentGcode, setCurrentGcode] = useState<string | null>(null);

  const compileGcode = useCallback((targetScene: Scene): string | null => {
    try {
      const job = compileJob(targetScene);
      if (job.operations.length === 0) return null;
      const plan = optimizePlan(job);
      const strategy = getOutputStrategy('grbl');
      if (!strategy) return null;
      const output = strategy.generate(plan, job);
      return output.text ?? null;
    } catch (err) {
      console.error('G-code compilation failed:', err);
      return null;
    }
  }, []);

  return { currentGcode, setCurrentGcode, compileGcode };
}
