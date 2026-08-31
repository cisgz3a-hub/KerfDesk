export function externalGcodePreviewStartWarning(name: string): string {
  return `“${name}” is open as a visualization-only G-code preview. Frame, Job Review, and Start use the current CurveDesk design, not that imported program.`;
}

export function appendExternalGcodePreviewWarning<T extends { warnings: ReadonlyArray<string> }>(
  model: T,
  name: string | undefined,
): T {
  if (name === undefined) return model;
  const warning = externalGcodePreviewStartWarning(name);
  return model.warnings.includes(warning)
    ? model
    : { ...model, warnings: [warning, ...model.warnings] };
}
