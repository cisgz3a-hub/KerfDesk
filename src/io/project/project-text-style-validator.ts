// Validates a text object's LightBurn text options read from a .lf2 file.

import {
  firstError,
  isObject,
  optionalBoolean,
  optionalPositiveNumber,
} from './project-shape-primitives';

export function validateTextStyle(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return `invalid \`${path}\``;
  return firstError([
    ...(['bold', 'italic', 'uppercase', 'forceRtl', 'bendUndistorted'] as const).map((key) =>
      optionalBoolean(value, `${path}.${key}`),
    ),
    optionalPositiveNumber(value, `${path}.maxWidthMm`),
  ]);
}
