import type { Project } from './project';
import { DEFAULT_PROJECT_VARIABLE_DATA } from './variable-template';
import { nextProjectVariableSequence } from '../variables/sequence-offset';

export type ProductionRowStatus =
  | 'pending'
  | 'reviewed'
  | 'completed'
  | 'skipped'
  | 'failed'
  | 'uncertain';
export type ProductionRow = {
  readonly id: string;
  readonly index: number;
  readonly recordIndex: number;
  readonly serialValue: number;
  readonly values: readonly string[];
  readonly status: ProductionRowStatus;
  readonly notes: string;
  readonly reviewedProjectJson?: string;
  readonly reviewedAt?: string;
  readonly resultAt?: string;
};
export type ProductionManifest = {
  readonly id: string;
  readonly name: string;
  readonly frozenAt: string;
  /** The shared editable design, without a manifest or sheet book. */
  readonly designProjectJson: string;
  readonly rows: readonly ProductionRow[];
  readonly activeRowId?: string;
};

/** Allocate once; opening, recording outcomes and resuming never allocate again. */
export function createProductionManifest(
  project: Project,
  input: {
    readonly name: string;
    readonly count: number;
    readonly now: Date;
    readonly designProjectJson: string;
    readonly idFactory: () => string;
  },
): ProductionManifest {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 500)
    throw new Error('Choose between 1 and 500 production rows.');
  if (input.name.trim() === '' || input.name.length > 200 || !Number.isFinite(input.now.getTime()))
    throw new Error('Name this production run and use a valid date.');
  const rows: ProductionRow[] = [];
  let variables = project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA;
  for (let index = 0; index < input.count; index += 1) {
    rows.push({
      id: input.idFactory(),
      index,
      recordIndex: variables.recordIndex,
      serialValue: variables.serialValue,
      values: variables.csv?.records[variables.recordIndex] ?? [],
      status: 'pending',
      notes: '',
    });
    variables = nextProjectVariableSequence({ ...project, variables });
  }
  return {
    id: input.idFactory(),
    name: input.name.trim(),
    frozenAt: input.now.toISOString(),
    designProjectJson: input.designProjectJson,
    rows,
  };
}
