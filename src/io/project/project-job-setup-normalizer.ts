import type { Project } from '../../core/scene';
import type { ProjectJobPlacement } from '../../core/scene/project';

export function normalizeProjectJobSetup(raw: unknown): Project['jobSetup'] {
  const setup = isObject(raw) ? raw : {};
  const placement = isObject(setup['placement']) ? setup['placement'] : {};
  const outputScope = isObject(setup['outputScope']) ? setup['outputScope'] : {};
  return {
    placement: normalizePlacement(placement),
    // The other mode's placement (ADR-416); shape validation has checked it.
    ...(isObject(setup['parkedPlacement'])
      ? { parkedPlacement: normalizePlacement(setup['parkedPlacement']) }
      : {}),
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

function normalizePlacement(placement: Record<string, unknown>): ProjectJobPlacement {
  return {
    startFrom: placement['startFrom'] as ProjectJobPlacement['startFrom'],
    anchor: placement['anchor'] as ProjectJobPlacement['anchor'],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
