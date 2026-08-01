import type { ProjectVariableData } from '../scene';
import { advanceVariableSequence } from './sequence';

export type VariableBatchSlot = {
  readonly slotIndex: number;
  readonly recordIndex: number;
  readonly serialValue: number;
};

export type VariableBatchPlan = {
  readonly slots: ReadonlyArray<VariableBatchSlot>;
  readonly nextVariables: ProjectVariableData;
};

/**
 * Plans variable contexts for an already-ordered, already-bounded slot list.
 * Seed values intentionally contribute only order and cardinality; they are
 * neither inspected nor retained, so final placement geometry can be derived
 * after every variable value has been rendered and measured.
 */
export function planVariableBatchSequence(
  variables: ProjectVariableData,
  slotSeeds: ReadonlyArray<unknown>,
): VariableBatchPlan {
  const slots: VariableBatchSlot[] = [];
  let nextVariables = variables;

  for (let slotIndex = 0; slotIndex < slotSeeds.length; slotIndex += 1) {
    slots.push({
      slotIndex,
      recordIndex: nextVariables.recordIndex,
      serialValue: nextVariables.serialValue,
    });
    nextVariables = advanceVariableSequence(nextVariables, 'next');
  }

  return { slots, nextVariables };
}
