import { isMaterialRecipe } from '../../core/material-library';
import {
  canonicalProcessRecipe,
  type ProcessRecipe,
  type ProcessRecipeResult,
  type ProcessRecipeStep,
} from '../../core/material-library/process-recipe';
import { RECIPE_TOOL_FIELDS } from '../../core/material-library/process-recipe-tools';
import { captureLayerOperationSettings, createLayer } from '../../core/scene';
import { isLayerColor } from '../../core/scene/layer';
import { normalizeCncMachineConfig } from '../project/deserialize-project';
import { normalizeLayer } from '../project/normalize-layer';
import { validateLayerOperationSettings } from '../project/project-layer-validator';

export function parseProcessRecipes(
  value: unknown,
): ProcessRecipeResult<ReadonlyArray<ProcessRecipe>> {
  if (value === undefined) return { kind: 'ok', value: [] };
  if (!Array.isArray(value)) return invalid('processRecipes must be an array');
  const recipes: ProcessRecipe[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    const parsed = parseRecipe(raw);
    if (parsed.kind === 'invalid') return parsed;
    if (ids.has(parsed.value.id)) return invalid(`duplicate process recipe id: ${parsed.value.id}`);
    ids.add(parsed.value.id);
    recipes.push(parsed.value);
  }
  return { kind: 'ok', value: recipes };
}

function parseRecipe(value: unknown): ProcessRecipeResult<ProcessRecipe> {
  if (!isRecord(value) || !validRecipeHeader(value))
    return invalid('Process recipe metadata is invalid');
  const parsedSteps = parseSteps(value.steps, value.machineKind);
  if (parsedSteps.kind === 'invalid') return parsedSteps;
  const steps = parsedSteps.value;
  if (!validPathSteps(value.pathSteps, steps.length))
    return invalid('Process recipe path assignments are invalid');
  const tools =
    value.machineKind === 'cnc'
      ? normalizeCncMachineConfig({ kind: 'cnc', tools: value.tools })?.tools
      : undefined;
  if (!validRecipeTools(value.tools, tools, value.machineKind))
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
      ...(value.pathSteps === undefined ? {} : { pathSteps: value.pathSteps }),
      ...(tools === undefined ? {} : { tools }),
    }),
  };
}

type RecipeHeader = Pick<ProcessRecipe, 'id' | 'name' | 'description' | 'revision' | 'machineKind'>;
function validRecipeHeader(
  value: Record<string, unknown>,
): value is Record<string, unknown> & RecipeHeader {
  return (
    nonempty(value.id) &&
    nonempty(value.name) &&
    nonempty(value.revision) &&
    typeof value.description === 'string' &&
    (value.machineKind === 'laser' || value.machineKind === 'cnc')
  );
}

function parseSteps(
  value: unknown,
  kind: ProcessRecipe['machineKind'],
): ProcessRecipeResult<ReadonlyArray<ProcessRecipeStep>> {
  if (!Array.isArray(value) || value.length === 0)
    return invalid('Process recipe needs at least one step');
  const steps: ProcessRecipeStep[] = [];
  for (const raw of value) {
    const step = parseStep(raw, kind);
    if (step.kind === 'invalid') return step;
    steps.push(step.value);
  }
  return { kind: 'ok', value: steps };
}

function validRecipeTools(
  value: unknown,
  tools: ProcessRecipe['tools'],
  kind: ProcessRecipe['machineKind'],
): boolean {
  if (kind === 'laser') return value === undefined;
  return (
    Array.isArray(value) &&
    sameJson(tools, value) &&
    (tools ?? []).every((tool) => nonempty(tool.id) && nonempty(tool.name))
  );
}

function validToolReferences(
  tools: ProcessRecipe['tools'],
  steps: ReadonlyArray<ProcessRecipeStep>,
): boolean {
  const ids = new Set(tools?.map((tool) => tool.id));
  return (
    ids.size === (tools?.length ?? 0) &&
    steps.every((step) =>
      RECIPE_TOOL_FIELDS.every(
        (field) => step.cnc?.[field] === undefined || ids.has(step.cnc[field] as string),
      ),
    )
  );
}

function parseStep(
  value: unknown,
  machineKind: ProcessRecipe['machineKind'],
): ProcessRecipeResult<ProcessRecipeStep> {
  if (!isRecord(value) || !validStepHeader(value))
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
  if (!validCncSettings(value.cnc, cnc, machineKind))
    return invalid('Process recipe CNC settings are invalid');
  return {
    kind: 'ok',
    value: {
      name: value.name,
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
  'name' | 'color' | 'output' | 'visible' | 'scanOffsetCalibrationMode'
>;
function validStepHeader(
  value: Record<string, unknown>,
): value is Record<string, unknown> & StepHeader {
  return (
    nonempty(value.name) &&
    typeof value.color === 'string' &&
    isLayerColor(value.color) &&
    typeof value.output === 'boolean' &&
    typeof value.visible === 'boolean' &&
    validCalibrationMode(value.scanOffsetCalibrationMode)
  );
}

function validCalibrationMode(value: unknown): boolean {
  return value === undefined || value === 'baseline' || value === 'verification';
}

function validCncSettings(
  raw: unknown,
  normalized: unknown,
  kind: ProcessRecipe['machineKind'],
): boolean {
  if (kind === 'laser') return raw === undefined;
  return isRecord(raw) && sameJson(normalized, raw) && nonempty(raw.toolId);
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
function invalid(reason: string): { readonly kind: 'invalid'; readonly reason: string } {
  return { kind: 'invalid', reason };
}
