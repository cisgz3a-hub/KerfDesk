import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';

// Compiler phases as the operator experiences them, not as the pipeline names
// them. Numeric progress only arrives for jobs the compiler fans out (CNC
// regions); every other preparation reads the phase alone, and the phase-less
// wording covers the seconds before the first report. Frame and Preview share
// it, so a long CNC preparation reads the same wherever it is waited for.
const PREPARING_PHASE_TEXT: Record<OutputCompilationProgress['phase'], string> = {
  normalizing: 'reading shapes',
  planning: 'planning toolpaths',
  merging: 'merging results',
  finalizing: 'finishing',
};

/** "" before the first report, then " — <phase>" and, with a count, " <done>/<total>". */
export function preparationProgressSuffix(progress: OutputCompilationProgress | null): string {
  if (progress === null) return '';
  const phase = PREPARING_PHASE_TEXT[progress.phase];
  if (progress.total <= 0) return ` — ${phase}`;
  return ` — ${phase} ${progress.completed}/${progress.total}`;
}
