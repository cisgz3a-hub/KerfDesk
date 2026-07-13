import type { ProjectVariableData, VariableSequenceSettings } from '../scene';

export type VariableSequenceDirection = 'next' | 'previous' | 'reset';

export function resolveVariableSequence(data: ProjectVariableData): VariableSequenceSettings {
  const lastRecordIndex = Math.max(0, (data.csv?.records.length ?? 1) - 1);
  const requested = data.sequence;
  const recordStartIndex = clampInteger(requested?.recordStartIndex ?? 0, 0, lastRecordIndex);
  const recordEndIndex = clampInteger(
    requested?.recordEndIndex ?? lastRecordIndex,
    recordStartIndex,
    lastRecordIndex,
  );
  const serialStartValue = nonNegativeInteger(requested?.serialStartValue, 1);
  const requestedSerialEnd = requested?.serialEndValue;
  const serialEndValue =
    requestedSerialEnd === undefined
      ? undefined
      : Math.max(serialStartValue, nonNegativeInteger(requestedSerialEnd, serialStartValue));
  return {
    recordStartIndex,
    recordEndIndex,
    serialStartValue,
    ...(serialEndValue === undefined ? {} : { serialEndValue }),
    advanceBy: positiveInteger(requested?.advanceBy, 1),
  };
}

export function advanceVariableSequence(
  data: ProjectVariableData,
  direction: VariableSequenceDirection,
): ProjectVariableData {
  const sequence = resolveVariableSequence(data);
  if (direction === 'reset') {
    return {
      ...data,
      recordIndex: data.csv === undefined ? data.recordIndex : sequence.recordStartIndex,
      serialValue: sequence.serialStartValue,
      sequence,
    };
  }
  const delta = direction === 'next' ? sequence.advanceBy : -sequence.advanceBy;
  return {
    ...data,
    recordIndex:
      data.csv === undefined
        ? data.recordIndex
        : wrap(data.recordIndex, delta, sequence.recordStartIndex, sequence.recordEndIndex),
    serialValue: advanceSerial(data.serialValue, delta, sequence),
    sequence,
  };
}

function advanceSerial(current: number, delta: number, sequence: VariableSequenceSettings): number {
  if (sequence.serialEndValue !== undefined) {
    return wrap(current, delta, sequence.serialStartValue, sequence.serialEndValue);
  }
  const next = current + delta;
  if (!Number.isSafeInteger(next)) return current;
  return Math.max(sequence.serialStartValue, next);
}

function wrap(current: number, delta: number, start: number, end: number): number {
  const span = end - start + 1;
  const normalized =
    Number.isSafeInteger(current) && current >= start && current <= end
      ? current
      : delta >= 0
        ? start - delta
        : end - delta;
  return start + modulo(normalized - start + delta, span);
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function clampInteger(value: number, min: number, max: number): number {
  const finite = Number.isSafeInteger(value) ? value : min;
  return Math.min(max, Math.max(min, finite));
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) ? Math.max(0, value) : fallback;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) ? Math.max(1, value) : fallback;
}
