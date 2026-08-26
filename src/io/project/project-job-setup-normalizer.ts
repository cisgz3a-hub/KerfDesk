import type { Project } from '../../core/scene';

export function normalizeProjectJobSetup(raw: unknown): Project['jobSetup'] {
  const setup = isObject(raw) ? raw : {};
  const placement = isObject(setup['placement']) ? setup['placement'] : {};
  const outputScope = isObject(setup['outputScope']) ? setup['outputScope'] : {};
  return {
    placement: {
      startFrom: placement['startFrom'] as Project['jobSetup']['placement']['startFrom'],
      anchor: placement['anchor'] as Project['jobSetup']['placement']['anchor'],
    },
    outputScope: {
      cutSelectedGraphics: outputScope['cutSelectedGraphics'] === true,
      useSelectionOrigin:
        outputScope['cutSelectedGraphics'] === true && outputScope['useSelectionOrigin'] === true,
      selectedObjectIds: Array.isArray(outputScope['selectedObjectIds'])
        ? [...new Set(outputScope['selectedObjectIds'] as ReadonlyArray<string>)]
        : [],
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
