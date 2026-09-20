/** The machine rail and its persistent job dock share the same transport busy state. */
export function jobNeedsRecovery(status: string | undefined): boolean {
  return (
    status !== undefined &&
    ['streaming', 'paused', 'tool-change', 'errored', 'done'].includes(status)
  );
}

export function jobControlsBusy(
  status: string | undefined,
  motionOperation: unknown,
  controllerOperation: unknown,
): boolean {
  return jobNeedsRecovery(status) || motionOperation !== null || controllerOperation !== null;
}
