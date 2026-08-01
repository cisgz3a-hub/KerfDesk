import type { ArrayPlacement, ProjectVariableData } from '../scene';
import { advanceVariableSequence } from './sequence';

export type VariableBatchSlot = {
  readonly slotIndex: number;
  readonly placement: ArrayPlacement;
  readonly recordIndex: number;
  readonly serialValue: number;
};

export type VariableBatchPlan = {
  readonly slots: ReadonlyArray<VariableBatchSlot>;
  readonly nextVariables: ProjectVariableData;
};

export function planVariableBatchSequence(
  variables: ProjectVariableData,
  placements: ReadonlyArray<ArrayPlacement>,
): VariableBatchPlan {
  const slots: VariableBatchSlot[] = [];
  let nextVariables = variables;
  let slotIndex = 0;

  for (const placement of placements) {
    slots.push({
      slotIndex,
      placement,
      recordIndex: nextVariables.recordIndex,
      serialValue: nextVariables.serialValue,
    });
    nextVariables = advanceVariableSequence(nextVariables, 'next');
    slotIndex += 1;
  }

  return { slots, nextVariables };
}
