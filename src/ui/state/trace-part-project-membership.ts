import type { Project, TracedImage } from '../../core/scene';
import type { ProcessRecipeBinding } from '../../core/material-library/process-recipe-application';
import { validateProcessRecipeApplications } from '../../io/project/project-process-recipe-validator';
import { validateProductionNestDefinition } from '../../io/project/project-production-nest-validator';
import { validateCncTwoSidedSetup } from '../../io/project/project-cnc-two-sided-validator';

/** Recipe name selectors use the source label when the artwork has no explicit name. */
export function withTracePartRecipeName(
  project: Project,
  source: TracedImage,
  part: TracedImage,
): TracedImage {
  return part.name !== undefined ||
    !project.processRecipeApplications?.some((application) =>
      application.objectIds.includes(source.id),
    )
    ? part
    : { ...part, name: source.source };
}

/** A split partitions geometry; retained manufacturing intent still owns both pieces. */
export function withTracePartMembership(
  project: Project,
  source: TracedImage,
  remainder: TracedImage,
  part: TracedImage,
  pathIndex: number,
): Project {
  const expand = (ids: readonly string[]): readonly string[] =>
    ids.includes(source.id) && !ids.includes(part.id)
      ? ids.flatMap((id) => (id === source.id ? [id, part.id] : [id]))
      : ids;
  const nest = project.productionNest;
  const applications = project.processRecipeApplications;
  const cncSetup = expandedSides(project.cncSetup, expand);
  return {
    ...project,
    ...(cncSetup === undefined || cncSetup === project.cncSetup ? {} : { cncSetup }),
    ...(nest === undefined || !nest.parts.some((entry) => entry.objectIds.includes(source.id))
      ? {}
      : {
          productionNest: {
            ...nest,
            parts: nest.parts.map((entry) => ({ ...entry, objectIds: expand(entry.objectIds) })),
          },
        }),
    ...(applications === undefined ||
    !applications.some((application) => application.objectIds.includes(source.id))
      ? {}
      : {
          processRecipeApplications: applications.map((application) => {
            if (!application.objectIds.includes(source.id)) return application;
            return {
              ...application,
              objectIds: expand(application.objectIds),
              bindings: application.bindings.flatMap((binding) =>
                binding.objectId !== source.id
                  ? [binding]
                  : [
                      subsetBinding(
                        binding,
                        remainder.id,
                        source.paths
                          .map((_, index) => index)
                          .filter(
                            (index) =>
                              source.paths.length === remainder.paths.length || index !== pathIndex,
                          ),
                      ),
                      subsetBinding(binding, part.id, [pathIndex]),
                    ],
              ),
            };
          }),
        }),
  };
}

/** Reuse the file's existing retained-intent limits before committing a split. */
export function tracePartMembershipError(before: Project, after: Project): string | null {
  return (
    (before.processRecipeApplications === after.processRecipeApplications
      ? null
      : validateProcessRecipeApplications(after.processRecipeApplications)) ??
    (before.productionNest === after.productionNest
      ? null
      : validateProductionNestDefinition(after.productionNest)) ??
    (before.cncSetup?.twoSided === after.cncSetup?.twoSided
      ? null
      : validateCncTwoSidedSetup(after.cncSetup?.twoSided))
  );
}

function expandedSides(
  setup: Project['cncSetup'],
  expand: (ids: readonly string[]) => readonly string[],
): Project['cncSetup'] {
  const sides = setup?.twoSided;
  if (setup === undefined || sides === undefined) return setup;
  const sideAObjectIds = expand(sides.sideAObjectIds);
  const sideBObjectIds = expand(sides.sideBObjectIds);
  return sideAObjectIds === sides.sideAObjectIds && sideBObjectIds === sides.sideBObjectIds
    ? setup
    : { ...setup, twoSided: { ...sides, sideAObjectIds, sideBObjectIds } };
}

function subsetBinding(
  binding: ProcessRecipeBinding,
  objectId: string,
  pathIndices: readonly number[],
): ProcessRecipeBinding {
  return {
    ...binding,
    objectId,
    ...(binding.pathOperationIds === undefined
      ? {}
      : {
          // Preserve baselines rather than snapshotting current bindings: operator
          // overrides must remain distinguishable when the template is reapplied.
          pathOperationIds: pathIndices.map(
            (index) => binding.pathOperationIds?.[index] ?? binding.operationIds,
          ),
        }),
  };
}
