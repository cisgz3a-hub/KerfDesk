// How Cut Settings reads one number box into its patch (cut-settings-draft.ts).

// `stored` is the value the field opened with. Submitted unchanged, it is kept
// even outside the range a new entry is held to: a LightBurn layer's 0.03 mm
// interval or 33.3 mm/s speed, an inch speed or a 22.5° angle is what compiles,
// and an Apply for another field must not rewrite it (audit 2026-10-21
// 06-P2-4). Only a new entry is clamped.
export function numberField(
  data: FormData,
  name: string,
  stored: number,
  min: number,
  max: number,
): number {
  const parsed = submittedNumber(data, name);
  if (!Number.isFinite(parsed) || parsed === stored) return stored;
  return Math.max(min, Math.min(max, parsed));
}

// A limit that follows another field in the same form (minimum power under
// power, dot width under scan density) is reconciled even when this field was
// left alone.
export function reconciledNumberField(
  data: FormData,
  name: string,
  stored: number,
  min: number,
  max: number,
): number {
  const parsed = submittedNumber(data, name);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : stored));
}

export function submittedNumber(data: FormData, name: string): number {
  return Number.parseFloat(String(data.get(name) ?? ''));
}
