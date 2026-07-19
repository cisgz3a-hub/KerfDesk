import {
  firstError,
  optionalLiteral,
  optionalPositiveInteger,
  optionalString,
} from './project-shape-primitives';

export function validateTracedImageMetadata(
  obj: Record<string, unknown>,
  path: string,
): string | null {
  return firstError([
    optionalString(obj, `${path}.traceSourceId`),
    optionalPositiveInteger(obj, `${path}.tracePixelWidth`),
    optionalPositiveInteger(obj, `${path}.tracePixelHeight`),
    optionalLiteral(obj, `${path}.traceMode`, ['filled-contours', 'centerline', 'edge']),
  ]);
}
