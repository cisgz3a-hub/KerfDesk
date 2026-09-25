// Optional device fields that are normalized rather than validated: a
// malformed value is dropped so an otherwise good project still opens.

/**
 * Preserve an explicit worker-transport opt-out as well as opt-in. Absent stays
 * absent so old projects use the compatible driver's default. The unreliable
 * air restart flag remains true-only; malformed values gain no authority.
 */
export function optionalDeviceFields(
  dev: Record<string, unknown>,
): Record<string, boolean | string | undefined> {
  const savedMachineId = dev['savedMachineId'];
  return {
    workerHostedStreaming:
      typeof dev['workerHostedStreaming'] === 'boolean' ? dev['workerHostedStreaming'] : undefined,
    ...(dev['airAssistRestartUnreliable'] === true
      ? { airAssistRestartUnreliable: true as const }
      : {}),
    // The My machines link (ADR-374) is only a label naming a saved machine.
    savedMachineId:
      typeof savedMachineId === 'string' && savedMachineId.trim() !== ''
        ? savedMachineId
        : undefined,
  };
}
