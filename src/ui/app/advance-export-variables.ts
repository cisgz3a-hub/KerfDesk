import type { OutputScope, Project } from '../../core/scene';

export type ExportVariableAdvancement = {
  readonly advanceVariablesAfter?: (
    expectedProject: Project,
    trigger: 'successful-export',
    outputScope?: OutputScope,
  ) => void;
};

/** Called only after the complete requested output has been written. */
export function advanceExportVariables(
  ctx: ExportVariableAdvancement & {
    readonly project: Project;
    readonly outputScope?: OutputScope;
  },
): void {
  if (ctx.advanceVariablesAfter === undefined) return;
  if (ctx.outputScope === undefined) ctx.advanceVariablesAfter(ctx.project, 'successful-export');
  else ctx.advanceVariablesAfter(ctx.project, 'successful-export', ctx.outputScope);
}
