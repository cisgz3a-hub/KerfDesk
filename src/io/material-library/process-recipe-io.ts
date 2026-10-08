import { isMaterialRecipe } from '../../core/material-library';
import {
  canonicalProcessRecipe,
  type ProcessRecipe,
  type ProcessRecipeResult,
  type ProcessRecipeStep,
} from '../../core/material-library/process-recipe';
import { recipeCncToolIds } from '../../core/material-library/process-recipe-tools';
import { captureLayerOperationSettings, createLayer } from '../../core/scene';
import { isLayerColor } from '../../core/scene/layer';
import { normalizeCncMachineConfig } from '../project/deserialize-project';
import { normalizeLayer } from '../project/normalize-layer';
import { validateLayerOperationSettings } from '../project/project-layer-validator';
import {
  parseRecipeRoles,
  validRecipeDependencies,
  validStepDependencies,
} from './process-recipe-selectors-io';

export function parseProcessRecipes(
  value: unknown,
): ProcessRecipeResult<ReadonlyArray<ProcessRecipe>> {
  if (value === undefined) return { kind: 'ok', value: [] };
  if (!Array.isArray(value)) return invalid('processRecipes must be an array');
  const recipes: ProcessRecipe[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    const parsed = parseProcessRecipe(raw);
    if (parsed.kind === 'invalid') return parsed;
    if (ids.has(parsed.value.id)) return invalid(`duplicate process recipe id: ${parsed.value.id}`);
    ids.add(parsed.value.id);
    recipes.push(parsed.value);
  }
  return { kind: 'ok', value: recipes };
}

export function parseProcessRecipe(value: unknown): ProcessRecipeResult<ProcessRecipe> {
  if (!isRecord(value) || !validRecipeHeader(value))
    return invalid('Process recipe metadata is invalid');
  const boundedMetadata = value.roles !== undefined;
  const parsedSteps = parseSteps(value.steps, value.machineKind, boundedMetadata);
  if (parsedSteps.kind === 'invalid') return parsedSteps;
  const steps = parsedSteps.value;
  const topologyError = recipeTopologyProblem(value, steps);
  if (topologyError !== null) return invalid(topologyError);
  const roles = parseRecipeRoles(value.roles, steps.length);
  if (roles === null) return invalid('Process recipe selectors are invalid');
  const pathSteps = validPathSteps(value.pathSteps, steps.length) ? value.pathSteps : undefined;
  const tools = normalizedRecipeTools(value);
  if (!validRecipeTools(value.tools, tools, value.machineKind, boundedMetadata))
    return invalid('Process recipe cutters are invalid');
  if (!validToolReferences(tools, steps))
    return invalid('Process recipe cutter references are invalid');
  return {
    kind: 'ok',
    value: canonicalProcessRecipe({
      id: value.id,
      name: value.name,
      description: value.description,
      revision: value.revision,
      machineKind: value.machineKind,
      steps,
      ...(pathSteps === undefined ? {} : { pathSteps }),
      ...(tools === undefined ? {} : { tools }),
      ...(roles === undefined ? {} : { roles }),
    }),
  };
}

function normalizedRecipeTools(value: Record<string, unknown>): ProcessRecipe['tools'] {
  return value.machineKind === 'cnc'
    ? normalizeCncMachineConfig({ kind: 'cnc', tools: value.tools })?.tools
    : undefined;
}
function recipeTopologyProblem(
  value: Record<string, unknown>,
  steps: ReadonlyArray<ProcessRecipeStep>,
): string | null {
  if (!validRecipeDependencies(steps))
    return 'Process recipe step dependencies are invalid or cyclic';
  if (value.roles !== undefined && (value.machineKind !== 'cnc' || value.pathSteps !== undefined))
    return 'Process recipe selectors are invalid';
  if (!validPathSteps(value.pathSteps, steps.length))
    return 'Process recipe path assignments are invalid';
  return null;
}

type RecipeHeader = Pick<ProcessRecipe, 'id' | 'name' | 'description' | 'revision' | 'machineKind'>;
function validRecipeHeader(
  value: Record<string, unknown>,
): value is Record<string, unknown> & RecipeHeader {
  const label = value.roles === undefined ? nonempty : boundedLabel;
  return (
    label(value.id) &&
    label(value.name) &&
    label(value.revision) &&
    typeof value.description === 'string' &&
    (value.roles === undefined || value.description.length <= 10000) &&
    (value.machineKind === 'laser' || value.machineKind === 'cnc')
  );
}

function parseSteps(
  value: unknown,
  kind: ProcessRecipe['machineKind'],
  boundedMetadata: boolean,
): ProcessRecipeResult<ReadonlyArray<ProcessRecipeStep>> {
  if (!Array.isArray(value) || value.length === 0 || (boundedMetadata && value.length > 256))
    return invalid('Process recipe needs at least one step');
  const steps: ProcessRecipeStep[] = [];
  for (const raw of value) {
    const step = parseProcessRecipeStep(raw, kind, boundedMetadata);
    if (step.kind === 'invalid') return step;
    steps.push(step.value);
  }
  return { kind: 'ok', value: steps };
}

function validRecipeTools(
  value: unknown,
  tools: ProcessRecipe['tools'],
  kind: ProcessRecipe['machineKind'],
  boundedMetadata: boolean,
): boolean {
  if (kind === 'laser') return value === undefined;
  const label = boundedMetadata ? boundedLabel : nonempty;
  return (
    Array.isArray(value) &&
    (!boundedMetadata || value.length <= 256) &&
    sameJson(tools, value) &&
    (tools ?? []).every((tool) => label(tool.id) && label(tool.name))
  );
}

function validToolReferences(
  tools: ProcessRecipe['tools'],
  steps: ReadonlyArray<ProcessRecipeStep>,
): boolean {
  const ids = new Set(tools?.map((tool) => tool.id));
  return (
    ids.size === (tools?.length ?? 0) &&
    steps.every((step) => recipeCncToolIds(step.cnc).every((id) => ids.has(id)))
  );
}

export function parseProcessRecipeStep(
  value: unknown,
  machineKind: ProcessRecipe['machineKind'],
  boundedMetadata = true,
): ProcessRecipeResult<ProcessRecipeStep> {
  if (!isRecord(value) || !validStepHeader(value, boundedMetadata))
    return invalid('Process recipe step metadata is invalid');
  if (
    !isMaterialRecipe(value.settings) ||
    validateLayerOperationSettings(value.settings, 'step.settings') !== null
  )
    return invalid('Process recipe step settings are invalid');
  const settings = captureLayerOperationSettings({
    ...createLayer({ id: 'recipe', color: value.color }),
    ...value.settings,
  });
  if (!sameJson(settings, value.settings))
    return invalid('Process recipe step settings are incomplete or unsupported');
  const normalized = normalizeLayer({ cnc: value.cnc });
  const cnc = isRecord(normalized) ? normalized.cnc : undefined;
  if (!validCncSettings(value.cnc, cnc, machineKind, boundedMetadata))
    return invalid('Process recipe CNC settings are invalid');
  return {
    kind: 'ok',
    value: {
      name: value.name,
      ...(value.dependsOn === undefined ? {} : { dependsOn: value.dependsOn }),
      color: value.color,
      output: value.output,
      visible: value.visible,
      settings,
      ...(cnc === undefined ? {} : { cnc: cnc as NonNullable<ProcessRecipeStep['cnc']> }),
      ...(value.scanOffsetCalibrationMode === undefined
        ? {}
        : { scanOffsetCalibrationMode: value.scanOffsetCalibrationMode }),
    },
  };
}

type StepHeader = Pick<
  ProcessRecipeStep,
  'name' | 'dependsOn' | 'color' | 'output' | 'visible' | 'scanOffsetCalibrationMode'
>;
function validStepHeader(
  value: Record<string, unknown>,
  boundedMetadata: boolean,
): value is Record<string, unknown> & StepHeader {
  const label = boundedMetadata ? boundedLabel : nonempty;
  return (
    label(value.name) &&
    typeof value.color === 'string' &&
    isLayerColor(value.color) &&
    typeof value.output === 'boolean' &&
    typeof value.visible === 'boolean' &&
    validCalibrationMode(value.scanOffsetCalibrationMode) &&
    validStepDependencies(value.dependsOn, 256)
  );
}

function validCalibrationMode(value: unknown): boolean {
  return value === undefined || value === 'baseline' || value === 'verification';
}

function validCncSettings(
  raw: unknown,
  normalized: unknown,
  kind: ProcessRecipe['machineKind'],
  boundedMetadata: boolean,
): boolean {
  if (kind === 'laser') return raw === undefined;
  const label = boundedMetadata ? boundedLabel : nonempty;
  return isRecord(raw) && sameJson(normalized, raw) && label(raw.toolId);
}

function validPathSteps(value: unknown, count: number): value is ProcessRecipe['pathSteps'] {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length > 0 &&
      value.every(
        (indices: unknown) =>
          Array.isArray(indices) &&
          new Set(indices).size === indices.length &&
          indices.every(
            (index: unknown) =>
              typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < count,
          ),
      ))
  );
}

function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item: unknown, index) => sameJson(item, b[index]))
    );
  if (!isRecord(a) || !isRecord(b)) return a === b;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => sameJson(a[key], b[key]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function boundedLabel(value: unknown): value is string {
  return nonempty(value) && value.length <= 200;
}
function invalid(reason: string): { readonly kind: 'invalid'; readonly reason: string } {
  return { kind: 'invalid', reason };
}
