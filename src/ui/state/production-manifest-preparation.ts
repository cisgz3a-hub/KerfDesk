import { DEFAULT_PROJECT_VARIABLE_DATA, type Project } from '../../core/scene';
import type { ProductionManifest, ProductionRow } from '../../core/scene/production-manifest';
import { deserializeProject, serializeProject } from '../../io/project';
import {
  materializeVariableText,
  type VariableTextRenderer,
} from '../../io/gcode/prepare-output-snapshot';

export function withoutProductionArchives(project: Project): Project {
  const { sheetBook: _book, productionManifest: _manifest, ...design } = project;
  return design;
}
export function productionVariantJson(project: Project): string {
  return serializeProject(withoutProductionArchives(project), { compact: true });
}

/** Fixed values and geometry stay fixed even if the file is opened next week. */
export async function prepareProductionRow(
  manifest: ProductionManifest,
  row: ProductionRow,
  render: VariableTextRenderer,
): Promise<Project> {
  const loaded = deserializeProject(row.reviewedProjectJson ?? manifest.designProjectJson);
  if (loaded.kind !== 'ok') throw new Error('The production design cannot be reopened.');
  if (row.reviewedProjectJson !== undefined) return loaded.project;
  const result = await materializeVariableText(
    loaded.project,
    {
      now: new Date(manifest.frozenAt),
      recordIndex: row.recordIndex,
      serialValue: row.serialValue,
    },
    render,
  );
  if (!result.ok) throw new Error(result.preflight.issues.map((issue) => issue.message).join(' '));
  const variables = result.project.variables;
  return {
    ...result.project,
    ...(variables === undefined
      ? {}
      : {
          variables: {
            ...variables,
            recordIndex: row.recordIndex,
            serialValue: row.serialValue,
            advancement: 'manual' as const,
          },
        }),
  };
}

/** New variable edits in a row use the original allocation, not a later working CSV/cursor. */
export function productionRowProject(
  project: Project,
  manifest: ProductionManifest,
  row: ProductionRow,
): Project {
  const loaded = deserializeProject(manifest.designProjectJson);
  if (loaded.kind !== 'ok') throw new Error('The production design cannot be reopened.');
  return {
    ...withoutProductionArchives(project),
    variables: {
      ...(loaded.project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA),
      recordIndex: row.recordIndex,
      serialValue: row.serialValue,
      advancement: 'manual',
    },
  };
}
