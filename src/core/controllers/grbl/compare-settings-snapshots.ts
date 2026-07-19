export type ComparableControllerSetting = {
  readonly id: number;
  readonly rawValue: string;
};

export type ComparableControllerSettingsSnapshot = {
  readonly settings: ReadonlyArray<ComparableControllerSetting>;
};

export type ControllerSettingComparisonStatus =
  | 'equivalent'
  | 'different'
  | 'missing-left'
  | 'missing-right';

export type ControllerSettingComparisonBasis = 'numeric' | 'raw' | 'missing';

/** A neutral A/B comparison. Positive and negative deltas do not imply quality. */
export type ControllerSettingComparison = {
  readonly id: number;
  readonly code: `$${number}`;
  readonly leftRawValue: string | null;
  readonly rightRawValue: string | null;
  readonly leftNumericValue: number | null;
  readonly rightNumericValue: number | null;
  readonly status: ControllerSettingComparisonStatus;
  readonly basis: ControllerSettingComparisonBasis;
  readonly delta: number | null;
  /** Relative numeric delta from the left value; null when left is zero or unavailable. */
  readonly percentDeltaFromLeft: number | null;
};

export function compareSettingsSnapshots(
  left: ComparableControllerSettingsSnapshot,
  right: ComparableControllerSettingsSnapshot,
): ReadonlyArray<ControllerSettingComparison> {
  const leftById = validatedSettingMap(left.settings, 'left');
  const rightById = validatedSettingMap(right.settings, 'right');
  const ids = Array.from(new Set([...leftById.keys(), ...rightById.keys()])).sort((a, b) => a - b);
  return ids.map((id) => compareSetting(id, leftById.get(id), rightById.get(id)));
}

function compareSetting(
  id: number,
  leftRawValue: string | undefined,
  rightRawValue: string | undefined,
): ControllerSettingComparison {
  const code = `$${id}` as `$${number}`;
  if (leftRawValue === undefined) {
    return {
      id,
      code,
      leftRawValue: null,
      rightRawValue: rightRawValue ?? null,
      leftNumericValue: null,
      rightNumericValue: finiteNumber(rightRawValue),
      status: 'missing-left',
      basis: 'missing',
      delta: null,
      percentDeltaFromLeft: null,
    };
  }
  if (rightRawValue === undefined) {
    return {
      id,
      code,
      leftRawValue,
      rightRawValue: null,
      leftNumericValue: finiteNumber(leftRawValue),
      rightNumericValue: null,
      status: 'missing-right',
      basis: 'missing',
      delta: null,
      percentDeltaFromLeft: null,
    };
  }

  const leftNumericValue = finiteNumber(leftRawValue);
  const rightNumericValue = finiteNumber(rightRawValue);
  if (leftNumericValue === null || rightNumericValue === null) {
    return {
      id,
      code,
      leftRawValue,
      rightRawValue,
      leftNumericValue,
      rightNumericValue,
      status: leftRawValue === rightRawValue ? 'equivalent' : 'different',
      basis: 'raw',
      delta: null,
      percentDeltaFromLeft: null,
    };
  }

  const rawDelta = rightNumericValue - leftNumericValue;
  const delta = Number.isFinite(rawDelta) ? rawDelta : null;
  const rawPercentDelta =
    leftNumericValue === 0 ? null : (rawDelta / Math.abs(leftNumericValue)) * 100;
  const percentDeltaFromLeft =
    rawPercentDelta !== null && Number.isFinite(rawPercentDelta) ? rawPercentDelta : null;
  return {
    id,
    code,
    leftRawValue,
    rightRawValue,
    leftNumericValue,
    rightNumericValue,
    status: leftNumericValue === rightNumericValue ? 'equivalent' : 'different',
    basis: 'numeric',
    delta,
    percentDeltaFromLeft,
  };
}

function validatedSettingMap(
  settings: ReadonlyArray<ComparableControllerSetting>,
  side: 'left' | 'right',
): ReadonlyMap<number, string> {
  const result = new Map<number, string>();
  for (const [index, setting] of settings.entries()) {
    if (!Number.isSafeInteger(setting.id) || setting.id < 0) {
      throw new TypeError(`${side} settings[${index}].id must be a non-negative integer`);
    }
    if (typeof setting.rawValue !== 'string') {
      throw new TypeError(`${side} settings[${index}].rawValue must be a string`);
    }
    if (result.has(setting.id)) {
      throw new TypeError(`${side} settings contains duplicate id ${setting.id}`);
    }
    result.set(setting.id, setting.rawValue);
  }
  return result;
}

function finiteNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}
