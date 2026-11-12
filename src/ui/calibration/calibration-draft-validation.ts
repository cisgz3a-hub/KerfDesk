export type CalibrationDraftField<Key extends string> = {
  readonly key: Key;
  readonly label: string;
  readonly min: number;
  readonly max: number | undefined;
  // 'any' accepts every finite value at or above min: line intervals must take
  // DPI pitches such as 0.0635 mm (400 DPI), which no decimal step lands on.
  readonly step: number | 'any' | undefined;
};

/** Keep incomplete text distinct from numeric zero before scene replacement. */
export function calibrationDraftIssues<Key extends string>(
  draft: Readonly<Record<Key, string>>,
  fields: ReadonlyArray<CalibrationDraftField<Key>>,
): string[] {
  return fields.flatMap((field) => {
    const text = draft[field.key].trim();
    const value = Number(text);
    if (text === '' || !Number.isFinite(value)) return [`${field.label}: enter a number.`];
    if (value < field.min) return [`${field.label}: enter ${field.min} or greater.`];
    if (field.max !== undefined && value > field.max) {
      return [`${field.label}: enter ${field.max} or less.`];
    }
    if (field.step === 'any') return [];
    const step = field.step ?? 1;
    const steps = (value - field.min) / step;
    if (Math.abs(steps - Math.round(steps)) > 1e-7) {
      return [`${field.label}: use increments of ${step} from ${field.min}.`];
    }
    return [];
  });
}
