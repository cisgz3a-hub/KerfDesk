import {
  DEFAULT_PROJECT_VARIABLE_DATA,
  DEFAULT_OUTPUT_SCOPE,
  filterSceneForOutputScope,
  outputOperationLayers,
  sceneObjectUsesOperation,
  type OutputScope,
  type Project,
  type ProjectVariableData,
  type SceneObject,
} from '../scene';
import { advanceVariableSequence, resolveVariableSequence } from './sequence';

/** Same result as repeated Next, without work proportional to a persisted offset. */
export function advanceVariableSequenceBy(
  data: ProjectVariableData,
  count: number,
): ProjectVariableData {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid variable copy offset.');
  if (count === 0) return data;
  const first = advanceVariableSequence(data, 'next');
  if (count === 1) return first;
  const sequence = resolveVariableSequence(first);
  const remaining = BigInt(count - 1);
  const stride = BigInt(sequence.advanceBy);
  const delta = remaining * stride;
  const serialSteps = (BigInt(Number.MAX_SAFE_INTEGER) - BigInt(first.serialValue)) / stride;
  return {
    ...first,
    recordIndex:
      first.csv === undefined
        ? first.recordIndex
        : wrapped(first.recordIndex, delta, sequence.recordStartIndex, sequence.recordEndIndex),
    serialValue:
      sequence.serialEndValue === undefined
        ? Number(
            BigInt(first.serialValue) +
              (remaining < serialSteps ? remaining : serialSteps) * stride,
          )
        : wrapped(first.serialValue, delta, sequence.serialStartValue, sequence.serialEndValue),
  };
}

function wrapped(current: number, delta: bigint, start: number, end: number): number {
  return Number(
    BigInt(start) +
      ((BigInt(current) - BigInt(start) + delta) % (BigInt(end) - BigInt(start) + 1n)),
  );
}

export function variableCopyOffset(object: SceneObject): number | undefined {
  return object.kind === 'text' ? object.variableTemplate?.sequenceOffset : undefined;
}

/** Shared text fields and same-value duplicates consume one slot, not one object. */
export function nextProjectVariableSequence(
  project: Project,
  scope: OutputScope = DEFAULT_OUTPUT_SCOPE,
): ProjectVariableData {
  let steps = 0;
  const scene = filterSceneForOutputScope(project.scene, scope);
  const operations = scene.layers
    .flatMap(outputOperationLayers)
    .filter((layer) => layer.mode !== 'image');
  for (const object of scene.objects) {
    if (object.kind !== 'text' || object.variableTemplate === undefined) continue;
    if (!operations.some((operation) => sceneObjectUsesOperation(object, operation))) continue;
    steps = Math.max(steps, (variableCopyOffset(object) ?? 0) + 1);
  }
  return advanceVariableSequenceBy(project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA, steps);
}
