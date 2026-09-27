import type { CncPass } from '../job';

// Compiler-local provenance, consumed before the executable job is built.
type StagePass = CncPass & { readonly profileFinishStage?: true };

export function profileFinishStagePass(pass: CncPass): StagePass {
  return { ...pass, profileFinishStage: true };
}

/** Entry transforms have a one-to-one pass correspondence. */
export function preserveProfileFinishStages(
  source: ReadonlyArray<CncPass>,
  transformed: ReadonlyArray<CncPass>,
): ReadonlyArray<CncPass> {
  return transformed.map((pass, index) =>
    (source[index] as StagePass | undefined)?.profileFinishStage === true
      ? profileFinishStagePass(pass)
      : pass,
  );
}

export function profileStageRuns(
  passes: ReadonlyArray<CncPass>,
): ReadonlyArray<{ readonly finishing: boolean; readonly passes: ReadonlyArray<CncPass> }> {
  const runs: Array<{ finishing: boolean; passes: CncPass[] }> = [];
  for (const pass of passes) {
    const { profileFinishStage, ...geometry } = pass as StagePass;
    const finishing = profileFinishStage === true;
    let run = runs.at(-1);
    if (run === undefined || run.finishing !== finishing) {
      run = { finishing, passes: [] };
      runs.push(run);
    }
    run.passes.push(geometry);
  }
  return runs;
}
