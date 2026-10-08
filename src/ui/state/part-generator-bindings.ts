import type { Project } from '../../core/scene/project';
import type { GeneratedPartObject } from '../../core/parts/part-generator';

export function retainGeneratorRecipeBindings(
  project: Project,
  before: GeneratedPartObject,
  after: GeneratedPartObject,
): Project['processRecipeApplications'] {
  const oldKeys = before.partGenerator.pathKeys;
  return project.processRecipeApplications?.map((application) => ({
    ...application,
    bindings: application.bindings.map((binding) => {
      if (binding.objectId !== before.id || binding.pathOperationIds === undefined) return binding;
      const previous = binding.pathOperationIds;
      return {
        ...binding,
        pathOperationIds: after.partGenerator.pathKeys.map((key) => {
          const oldIndex = oldKeys.indexOf(key);
          if (oldIndex >= 0) return previous[oldIndex] ?? binding.operationIds;
          const prefix = key.startsWith('mount-') ? 'mount-' : 'hole-';
          return (
            previous[oldKeys.findIndex((candidate) => candidate.startsWith(prefix))] ??
            binding.operationIds
          );
        }),
      };
    }),
  }));
}
