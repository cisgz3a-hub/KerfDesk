// The number-to-text formats that several panels share.
//
// Code quality audit C1 (C6-P3-1) found a length formatted 21 different ways.
// This file does not change what any panel shows: each function below is a
// format that four or more files had written out separately, moved here under
// a name that says exactly what it prints. Seeing them side by side is the
// first step to choosing one; that choice is a product decision.

/** At most two decimals, trailing zeros dropped: 1.5 → "1.5", 2 → "2". */
export function formatUpTo2Decimals(value: number): string {
  return String(Number(value.toFixed(2)));
}

/** At most two decimals, rounded with `Math.round` instead of `toFixed`: 1.5 → "1.5". */
export function formatRoundedTo2Decimals(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** At most three decimals, trailing zeros dropped: 1.5 → "1.5". */
export function formatUpTo3Decimals(value: number): string {
  return Number(value.toFixed(3)).toString();
}

/** Always three decimals: 1.5 → "1.500". */
export function formatFixed3Decimals(value: number): string {
  return value.toFixed(3);
}

/** US digit grouping, at most one decimal: 1234.56 → "1,234.6". */
export function formatGroupedUpTo1Decimal(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/** US digit grouping, at most three decimals: 1234.5678 → "1,234.568". */
export function formatGroupedUpTo3Decimals(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
}
