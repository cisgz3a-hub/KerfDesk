export type CalibrationDraftField<Key extends string> = {
  readonly key: Key;
  readonly label: string;
  readonly min: number;
  readonly max: number | undefined;
  readonly step: number | undefined;
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
    const step = field.step ?? 1;
    const steps = (value - field.min) / step;
    if (Math.abs(steps - Math.round(steps)) > 1e-7) {
      return [`${field.label}: use increments of ${step} from ${field.min}.`];
    }
    return [];
  });
}
